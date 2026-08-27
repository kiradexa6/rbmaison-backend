import { Request } from 'express';
import { describeAccessToken, extractAccessToken } from './auth-token.util';

function requestOf(headers: Record<string, string | undefined>): Request {
  return { headers } as Request;
}

function unsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('extractAccessToken', () => {
  it('reads bearer tokens from Authorization header', () => {
    expect(
      extractAccessToken(
        requestOf({ authorization: 'Bearer admin-access-token' }),
      ),
    ).toBe('admin-access-token');
  });

  it('reads bearer tokens case-insensitively', () => {
    expect(
      extractAccessToken(
        requestOf({ authorization: 'bearer customer-access-token' }),
      ),
    ).toBe('customer-access-token');
  });

  it('reads Supabase auth cookies when Authorization header is absent', () => {
    const cookie = encodeURIComponent(
      JSON.stringify({ access_token: 'cookie-access-token' }),
    );

    expect(
      extractAccessToken(
        requestOf({
          cookie: `sb-project-auth-token=${cookie}`,
        }),
      ),
    ).toBe('cookie-access-token');
  });

  it('returns undefined when no token is present', () => {
    expect(extractAccessToken(requestOf({}))).toBeUndefined();
  });
});

describe('describeAccessToken', () => {
  it('describes missing tokens without treating them as JWTs', () => {
    expect(describeAccessToken(undefined)).toEqual({
      present: false,
      format: 'missing',
      projectRef: null,
      expired: null,
    });
  });

  it('reads the Supabase project ref and expiry from a JWT payload only', () => {
    const token = unsignedJwt({
      iss: 'https://elvypbekopexhcojpwki.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'user-id',
    });

    expect(describeAccessToken(token)).toEqual({
      present: true,
      format: 'jwt',
      projectRef: 'elvypbekopexhcojpwki',
      expired: false,
    });
  });

  it('marks opaque non-JWT tokens without logging their contents', () => {
    expect(describeAccessToken('not-a-jwt')).toEqual({
      present: true,
      format: 'non-jwt',
      projectRef: null,
      expired: null,
    });
  });
});
