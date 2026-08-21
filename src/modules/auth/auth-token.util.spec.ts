import { Request } from 'express';
import { extractAccessToken } from './auth-token.util';

function requestOf(headers: Record<string, string | undefined>): Request {
  return { headers } as Request;
}

describe('extractAccessToken', () => {
  it('reads bearer tokens from Authorization header', () => {
    expect(
      extractAccessToken(
        requestOf({ authorization: 'Bearer admin-access-token' }),
      ),
    ).toBe('admin-access-token');
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
