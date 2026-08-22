/**
 * Smoke-test every Control Center admin endpoint against a running NestJS API.
 *
 * Usage:
 *   set API_URL=https://rbmaison-backend-production-f5dd.up.railway.app
 *   set VERIFY_ADMIN_EMAIL=<admin>
 *   set VERIFY_ADMIN_PASSWORD=<password>
 *   npm run verify:control-center
 *
 * Optional:
 *   VERIFY_TARGET_USER_ID=<uuid>  — also GET historical overview for that user
 */

type ApiEnvelope<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string | string[];
  statusCode?: number;
};

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === 'object' && 'success' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success) {
      throw new Error(
        typeof envelope.message === 'string'
          ? envelope.message
          : JSON.stringify(envelope.message ?? envelope),
      );
    }
    return envelope.data as T;
  }
  return payload as T;
}

function countRows(data: unknown): number {
  if (Array.isArray(data)) {
    return data.length;
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of [
      'customerOrders',
      'merchantOrders',
      'unread',
      'read',
      'records',
      'rows',
    ]) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).length;
      }
    }
  }
  return 0;
}

async function request<T>(
  baseUrl: string,
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const text = await response.text();
  let json: ApiEnvelope<T> | T = {};
  if (text) {
    try {
      json = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new Error(`${path} returned non-JSON (${response.status})`);
    }
  }

  if (!response.ok) {
    const message =
      typeof (json as ApiEnvelope)?.message === 'string'
        ? (json as ApiEnvelope).message
        : JSON.stringify((json as ApiEnvelope)?.message ?? json);
    throw new Error(`${path} → ${response.status}: ${message}`);
  }

  return unwrap(json);
}

async function main() {
  const apiUrl = env('API_URL') ?? 'http://localhost:3000';
  const email = env('VERIFY_ADMIN_EMAIL');
  const password = env('VERIFY_ADMIN_PASSWORD');
  const targetUserId = env('VERIFY_TARGET_USER_ID');

  if (!email || !password) {
    fail(
      'Set VERIFY_ADMIN_EMAIL and VERIFY_ADMIN_PASSWORD to run Control Center verification.',
    );
  }

  console.log('\nControl Center API verification');
  console.log('================================');
  console.log(`API: ${apiUrl}\n`);

  const checks: Check[] = [];

  const health = await request<{
    details?: { supabase?: { projectRef?: string; configured?: boolean } };
    info?: { supabase?: { projectRef?: string; configured?: boolean } };
  }>(apiUrl, '/health', null, { method: 'GET' });

  const supabase =
    health.details?.supabase ?? health.info?.supabase ?? ({} as {
      projectRef?: string;
      configured?: boolean;
    });

  checks.push({
    name: 'Health / Supabase configured',
    ok: supabase.configured === true,
    detail: supabase.configured ? 'configured' : 'not configured',
  });

  const expectedRef = env('SUPABASE_PROJECT_REF') ?? 'elvypbekopexhcojpwki';
  checks.push({
    name: 'Health / projectRef matches Lovable',
    ok: supabase.projectRef === expectedRef,
    detail: `got ${supabase.projectRef ?? 'missing'}, expected ${expectedRef}`,
  });

  const login = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!login.ok) {
    fail(`Admin login failed (${login.status}). Check credentials and API Supabase alignment.`);
  }

  const loginJson = unwrap<{ session?: { accessToken?: string }; user?: { role?: string } }>(
    (await login.json()) as ApiEnvelope,
  );

  const token = loginJson.session?.accessToken;
  if (!token) {
    fail('Login succeeded but no accessToken in response.');
  }

  checks.push({
    name: 'Admin login',
    ok: loginJson.user?.role === 'admin',
    detail: `role=${loginJson.user?.role ?? 'unknown'}`,
  });

  const endpoints: Array<{ page: string; path: string }> = [
    { page: 'Dashboard / Users', path: '/admin/users' },
    { page: 'Dashboard / Merchants', path: '/admin/merchants' },
    { page: 'Dashboard / Stores', path: '/admin/stores' },
    { page: 'Dashboard / Products', path: '/admin/products' },
    { page: 'Dashboard / Orders', path: '/admin/orders' },
    { page: 'Finance / Addresses', path: '/admin/wallets/addresses' },
    { page: 'Finance / Deposits', path: '/admin/wallets/deposits' },
    { page: 'Finance / Withdrawals', path: '/admin/wallets/withdrawals' },
    { page: 'Finance / Transactions', path: '/admin/wallets/transactions' },
    { page: 'Orders / Shipment queue', path: '/admin/shipment-queue' },
    { page: 'Merchants / Applications', path: '/admin/merchants/applications' },
    { page: 'Notifications', path: '/admin/notifications' },
    { page: 'Security / Activity logs', path: '/admin/activity-logs' },
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await request(apiUrl, endpoint.path, token);
      const count = countRows(data);
      checks.push({
        name: endpoint.page,
        ok: true,
        detail: `${endpoint.path} → ${count} row(s)`,
      });
    } catch (error) {
      checks.push({
        name: endpoint.page,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (targetUserId) {
    try {
      const overview = await request(
        apiUrl,
        `/admin/users/${targetUserId}/historical-data`,
        token,
      );
      checks.push({
        name: 'Historical / overview',
        ok: true,
        detail: `user ${targetUserId} loaded`,
      });
      void overview;
    } catch (error) {
      checks.push({
        name: 'Historical / overview',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('Results:\n');
  for (const check of checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.name}`);
    console.log(`  ${check.detail}\n`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    fail(`${failed.length} check(s) failed. Fix Supabase alignment on Railway first if projectRef is wrong.`);
  }

  console.log('✅ All Control Center endpoints reachable with admin auth.\n');
}

void main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
