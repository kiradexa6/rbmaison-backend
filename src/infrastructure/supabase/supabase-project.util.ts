const LOCAL_SUPABASE_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'host.docker.internal',
]);

export function extractSupabaseProjectRef(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const hostname = new URL(url).hostname;
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const { hostname, port } = new URL(url);
    if (LOCAL_SUPABASE_HOSTS.has(hostname)) {
      return true;
    }
    if (port === '54321') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function assertProductionSupabaseTarget(
  supabaseUrl: string | undefined,
  expectedProjectRef: string | undefined,
): void {
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required');
  }

  if (isLocalSupabaseUrl(supabaseUrl)) {
    throw new Error(
      'Refusing production alignment against a local Supabase URL. Point SUPABASE_URL at the hosted RB Maison project.',
    );
  }

  const projectRef = extractSupabaseProjectRef(supabaseUrl);
  if (!projectRef) {
    throw new Error(
      'SUPABASE_URL must be a hosted Supabase project URL (https://<ref>.supabase.co).',
    );
  }

  if (expectedProjectRef && projectRef !== expectedProjectRef) {
    throw new Error(
      `SUPABASE_URL project ref "${projectRef}" does not match SUPABASE_PROJECT_REF "${expectedProjectRef}".`,
    );
  }
}
