/**
 * Smoke-test Stripe checkout auth against a running NestJS API.
 *
 * Usage:
 *   set API_URL=https://rbmaison-backend-production-f5dd.up.railway.app
 *   set VERIFY_USER_EMAIL=<existing production customer email>
 *   set VERIFY_USER_PASSWORD=<password>
 *   set VERIFY_ORDER_ID=<uuid of pending/awaiting_payment order owned by customer>
 *   npm run verify:stripe-checkout
 */

type ApiEnvelope<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string | string[];
  statusCode?: number;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

async function request<T>(
  baseUrl: string,
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<{ status: number; body: ApiEnvelope<T> | T }> {
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
  let body: ApiEnvelope<T> | T = {};
  if (text) {
    try {
      body = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new Error(`${path} returned non-JSON (${response.status})`);
    }
  }

  return { status: response.status, body };
}

async function main() {
  const apiUrl = env('API_URL') ?? 'http://localhost:3000';
  const email = env('VERIFY_USER_EMAIL');
  const password = env('VERIFY_USER_PASSWORD');
  const orderId = env('VERIFY_ORDER_ID');

  if (!email || !password) {
    fail('Set VERIFY_USER_EMAIL and VERIFY_USER_PASSWORD.');
  }

  console.log('\nRB Maison — Stripe checkout auth verification');
  console.log('============================================');
  console.log(`API: ${apiUrl}`);

  const health = await request(apiUrl, '/health', null);
  console.log(`Health: ${health.status}`);

  const login = await request<{ session?: { accessToken?: string } }>(
    apiUrl,
    '/auth/login',
    null,
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
  );

  const token =
    login.body &&
    typeof login.body === 'object' &&
    'data' in login.body &&
    login.body.data &&
    typeof login.body.data === 'object' &&
    'session' in login.body.data
      ? login.body.data.session?.accessToken
      : undefined;

  if (!token) {
    fail(
      `Login failed (${login.status}): ${JSON.stringify(
        (login.body as ApiEnvelope)?.message ?? login.body,
      )}`,
    );
  }

  const session = await request(apiUrl, '/auth/session', token);
  console.log(`Session: ${session.status}`);

  if (session.status === 401) {
    fail('Authenticated session check returned 401 after login.');
  }

  if (!orderId) {
    console.log(
      '✅ Customer auth succeeded. Set VERIFY_ORDER_ID to test checkout session creation.',
    );
    return;
  }

  const checkout = await request(apiUrl, `/orders/${orderId}/stripe/checkout`, token, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  console.log(`Stripe checkout: ${checkout.status}`);

  if (checkout.status === 401) {
    fail('Stripe checkout returned 401 for an authenticated customer.');
  }

  if (checkout.status >= 400) {
    fail(
      `Stripe checkout failed (${checkout.status}): ${JSON.stringify(
        (checkout.body as ApiEnvelope)?.message ?? checkout.body,
      )}`,
    );
  }

  console.log('✅ Stripe checkout auth verified.\n');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
