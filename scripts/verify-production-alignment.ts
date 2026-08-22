/**
 * Read-only verification that NestJS is pointed at the SAME hosted Supabase
 * project that powers the live Lovable frontend.
 *
 * Usage (from repo root, with production secrets in environment — never commit):
 *
 *   set SUPABASE_URL=https://elvypbekopexhcojpwki.supabase.co
 *   set SUPABASE_ANON_KEY=<same anon key as Lovable>
 *   set SUPABASE_SERVICE_ROLE_KEY=<server only>
 *   set SUPABASE_JWT_SECRET=<jwt secret from dashboard>
 *   set SUPABASE_PROJECT_REF=elvypbekopexhcojpwki
 *   set VERIFY_USER_EMAIL=<existing production user email>
 *   set VERIFY_USER_PASSWORD=<password>
 *   npm run verify:production-db
 *
 * This script is read-only. It does not migrate schema, create users, or modify data.
 */

import { createClient } from '@supabase/supabase-js';
import {
  assertProductionSupabaseTarget,
  extractSupabaseProjectRef,
} from '../src/infrastructure/supabase/supabase-project.util';

type CheckResult = {
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

async function countTable(admin: { from: (table: string) => any }, table: string): Promise<number | null> {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    return null;
  }

  return count ?? 0;
}

async function main() {
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const jwtSecret = env('SUPABASE_JWT_SECRET');
  const expectedRef = env('SUPABASE_PROJECT_REF');
  const verifyEmail = env('VERIFY_USER_EMAIL');
  const verifyPassword = env('VERIFY_USER_PASSWORD');

  if (!url || !anonKey || !serviceRoleKey || !jwtSecret) {
    fail(
      'Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_JWT_SECRET before running verification.',
    );
  }

  try {
    assertProductionSupabaseTarget(url, expectedRef);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const projectRef = extractSupabaseProjectRef(url);
  console.log('\nRB Maison — production database alignment check');
  console.log('================================================');
  console.log(`Target project ref: ${projectRef}`);
  console.log('Mode: read-only (no writes, no migrations)\n');

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks: CheckResult[] = [];

  const tableCounts: Record<string, number | null> = {};
  for (const table of [
    'profiles',
    'merchants',
    'merchant_applications',
    'orders',
    'wallets',
    'wallet_transactions',
    'products',
  ]) {
    tableCounts[table] = await countTable(admin, table);
  }

  const missingTables = Object.entries(tableCounts)
    .filter(([, count]) => count === null)
    .map(([table]) => table);

  checks.push({
    name: 'Core tables reachable',
    ok: missingTables.length === 0,
    detail:
      missingTables.length === 0
        ? 'profiles, merchants, orders, wallets, products accessible'
        : `Missing or inaccessible: ${missingTables.join(', ')}`,
  });

  const hasLiveData = Object.values(tableCounts).some(
    (count) => typeof count === 'number' && count > 0,
  );

  checks.push({
    name: 'Existing production records present',
    ok: hasLiveData,
    detail: Object.entries(tableCounts)
      .map(([table, count]) => `${table}=${count ?? 'error'}`)
      .join(', '),
  });

  if (!verifyEmail || !verifyPassword) {
    checks.push({
      name: 'Existing user auth + data access',
      ok: false,
      detail:
        'Skipped — set VERIFY_USER_EMAIL and VERIFY_USER_PASSWORD to test an existing production account.',
    });
  } else {
    const { data: signIn, error: signInError } =
      await anon.auth.signInWithPassword({
        email: verifyEmail,
        password: verifyPassword,
      });

    if (signInError || !signIn.session?.access_token || !signIn.user) {
      checks.push({
        name: 'Existing user login',
        ok: false,
        detail: signInError?.message ?? 'No session returned',
      });
    } else {
      const accessToken = signIn.session.access_token;
      const userId = signIn.user.id;

      const { data: authUser, error: authUserError } =
        await admin.auth.getUser(accessToken);

      checks.push({
        name: 'NestJS auth validation (service role getUser)',
        ok: !authUserError && authUser.user?.id === userId,
        detail: authUserError?.message ?? `userId=${userId}`,
      });

      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: profile, error: profileError } = await userClient
        .from('profiles')
        .select('id, user_id, email, role, status, full_name')
        .eq('user_id', userId)
        .maybeSingle();

      checks.push({
        name: 'Profile access',
        ok: !profileError && Boolean(profile),
        detail: profileError?.message ?? `role=${profile?.role}, status=${profile?.status}`,
      });

      const { data: applications, error: applicationsError } =
        await userClient.rpc('my_merchant_applications');

      checks.push({
        name: 'Store applications access',
        ok: !applicationsError,
        detail: applicationsError?.message ?? `count=${applications?.length ?? 0}`,
      });

      if (profile?.role === 'merchant') {
        const [
          { error: storeError },
          { data: wallets, error: walletsError },
          { data: walletTx, error: walletTxError },
          { data: orders, error: ordersError },
        ] = await Promise.all([
          userClient.rpc('merchant_store_profile'),
          userClient.from('wallets').select('id, currency, balance'),
          userClient
            .from('wallet_transactions')
            .select('id, type, amount, currency, status')
            .limit(5),
          userClient.from('orders').select('id, status, total_amount').limit(5),
        ]);

        checks.push({
          name: 'Merchant store profile',
          ok: !storeError,
          detail: storeError?.message ?? 'merchant_store_profile OK',
        });
        checks.push({
          name: 'Merchant wallet balances',
          ok: !walletsError && Array.isArray(wallets),
          detail:
            walletsError?.message ??
            `wallets=${wallets?.length ?? 0}, balances from DB only`,
        });
        checks.push({
          name: 'Merchant wallet ledger sample',
          ok: !walletTxError,
          detail: walletTxError?.message ?? `sampleTx=${walletTx?.length ?? 0}`,
        });
        checks.push({
          name: 'Merchant orders sample',
          ok: !ordersError,
          detail: ordersError?.message ?? `sampleOrders=${orders?.length ?? 0}`,
        });
      } else {
        const { data: orders, error: ordersError } = await userClient
          .from('orders')
          .select('id, status, total_amount')
          .limit(5);

        checks.push({
          name: 'Customer orders sample',
          ok: !ordersError,
          detail: ordersError?.message ?? `sampleOrders=${orders?.length ?? 0}`,
        });
      }
    }
  }

  console.log('Checks:');
  let allOk = true;
  for (const check of checks) {
    const icon = check.ok ? '✅' : '❌';
    console.log(`${icon} ${check.name}`);
    console.log(`   ${check.detail}`);
    if (!check.ok) {
      allOk = false;
    }
  }

  console.log('\nNext steps if all checks pass:');
  console.log('1. Deploy NestJS with THESE SAME Supabase env vars (server only for service role + JWT secret).');
  console.log('2. Confirm GET /api/v1/health shows supabase.projectRef =', projectRef);
  console.log('3. Do NOT change Lovable frontend auth until NestJS login is verified against this project.');
  console.log('4. Review schema diff before any db push — never db reset production.\n');

  if (!allOk) {
    process.exit(1);
  }

  console.log('✅ Production database alignment verified.\n');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
