import { validate } from './env.validation';

describe('Environment Validation', () => {
  it('should validate default configuration', () => {
    const result = validate({
      NODE_ENV: 'development',
      PORT: '3000',
    });

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
  });

  it('should transform CORS_ENABLED string to boolean', () => {
    const result = validate({
      CORS_ENABLED: 'false',
    });

    expect(result.CORS_ENABLED).toBe(false);
  });

  it('should throw on invalid PORT', () => {
    expect(() =>
      validate({
        PORT: '99999',
      }),
    ).toThrow();
  });

  it('should throw on invalid NODE_ENV', () => {
    expect(() =>
      validate({
        NODE_ENV: 'invalid',
      }),
    ).toThrow();
  });

  it('should require Supabase credentials in production', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
      }),
    ).toThrow(/SUPABASE_URL/);
  });

  it('should require an explicit CORS origin and JWT secret in production', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        CORS_ORIGIN: '*',
      }),
    ).toThrow(/SUPABASE_JWT_SECRET/);

    expect(() =>
      validate({
        NODE_ENV: 'production',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_JWT_SECRET: 'jwt-secret',
        CORS_ORIGIN: '*',
      }),
    ).toThrow(/CORS_ORIGIN/);
  });

  it('should accept production configuration with Supabase credentials', () => {
    const result = validate({
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_JWT_SECRET: 'jwt-secret',
      CORS_ORIGIN: 'https://rbmaison.example',
    });

    expect(result.NODE_ENV).toBe('production');
    expect(result.SUPABASE_URL).toBe('https://example.supabase.co');
    expect(result.SUPABASE_JWT_SECRET).toBe('jwt-secret');
  });
});
