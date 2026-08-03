export default () => ({
  app: {
    name: process.env.APP_NAME ?? 'TradingPlatform',
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  },
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origin: process.env.CORS_ORIGIN ?? '*',
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});
