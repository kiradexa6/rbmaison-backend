import { readEnvString } from './env.validation';

export default () => ({
  app: {
    name: readEnvString(process.env, 'APP_NAME') ?? 'RBMaison',
    env: readEnvString(process.env, 'NODE_ENV') ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: readEnvString(process.env, 'API_PREFIX') ?? 'api/v1',
  },
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origin: readEnvString(process.env, 'CORS_ORIGIN') ?? '*',
  },
  logging: {
    level: readEnvString(process.env, 'LOG_LEVEL') ?? 'info',
  },
  supabase: {
    url: readEnvString(process.env, 'SUPABASE_URL'),
    anonKey: readEnvString(process.env, 'SUPABASE_ANON_KEY'),
    serviceRoleKey: readEnvString(process.env, 'SUPABASE_SERVICE_ROLE_KEY'),
    jwtSecret: readEnvString(process.env, 'SUPABASE_JWT_SECRET'),
    projectRef: readEnvString(process.env, 'SUPABASE_PROJECT_REF'),
  },
  historicalData: {
    maxDays: parseInt(process.env.HISTORICAL_MAX_DAYS ?? '180', 10),
    maxDeposits: parseInt(process.env.HISTORICAL_MAX_DEPOSITS ?? '40', 10),
    maxWithdrawals: parseInt(
      process.env.HISTORICAL_MAX_WITHDRAWALS ?? '20',
      10,
    ),
    maxOrders: parseInt(process.env.HISTORICAL_MAX_ORDERS ?? '60', 10),
    maxWalletTransactions: parseInt(
      process.env.HISTORICAL_MAX_WALLET_TRANSACTIONS ?? '200',
      10,
    ),
    maxTotalRows: parseInt(process.env.HISTORICAL_MAX_TOTAL_ROWS ?? '400', 10),
  },
});
