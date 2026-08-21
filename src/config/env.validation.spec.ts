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

  it('should reject local Supabase URLs in production', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_JWT_SECRET: 'jwt-secret',
        CORS_ORIGIN: 'https://rbmaisons.com',
      }),
    ).toThrow(/local Supabase URL/);
  });

  it('should reject mismatched SUPABASE_PROJECT_REF in production', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        SUPABASE_URL: 'https://sbcyoaswsjfhhkypdniu.supabase.co',
        SUPABASE_PROJECT_REF: 'wrong-project-ref',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_JWT_SECRET: 'jwt-secret',
        CORS_ORIGIN: 'https://rbmaisons.com',
      }),
    ).toThrow(/does not match SUPABASE_PROJECT_REF/);
  });

  it('trims trailing whitespace and newlines on exact production variable names', () => {
    const result = validate({
      NODE_ENV: 'production\n',
      SUPABASE_URL: 'https://sbcyoaswsjfhhkypdniu.supabase.co \n',
      SUPABASE_ANON_KEY: ' anon-key\r\n',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key  ',
      SUPABASE_JWT_SECRET: '\tjwt-secret',
      CORS_ORIGIN: ' https://rbmaison.example\n',
    });

    expect(result.NODE_ENV).toBe('production');
    expect(result.SUPABASE_URL).toBe(
      'https://sbcyoaswsjfhhkypdniu.supabase.co',
    );
    expect(result.SUPABASE_ANON_KEY).toBe('anon-key');
    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-key');
    expect(result.SUPABASE_JWT_SECRET).toBe('jwt-secret');
    expect(result.CORS_ORIGIN).toBe('https://rbmaison.example');
  });

  it('does not read altered production variable names', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        'SUPABASE_URL ': 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_JWT_SECRET: 'jwt-secret',
        CORS_ORIGIN: 'https://rbmaison.example',
      }),
    ).toThrow(/SUPABASE_URL/);
  });

  it('treats whitespace-only production secrets as missing', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        SUPABASE_URL: '   \n',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_JWT_SECRET: 'jwt-secret',
        CORS_ORIGIN: 'https://rbmaison.example',
      }),
    ).toThrow(/SUPABASE_URL/);
  });
});
