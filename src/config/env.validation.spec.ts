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
});
