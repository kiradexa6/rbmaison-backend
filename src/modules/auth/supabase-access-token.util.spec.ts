import { createHmac } from 'node:crypto';
import {
  SupabaseAccessTokenError,
  verifySupabaseAccessToken,
} from './supabase-access-token.util';

const supabaseUrl = 'https://elvypbekopexhcojpwki.supabase.co';
const jwtSecret = 'test-jwt-secret';

function signToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('verifySupabaseAccessToken', () => {
  it('accepts a valid Supabase access token', () => {
    const token = signToken({
      iss: `${supabaseUrl}/auth/v1`,
      aud: 'authenticated',
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'customer@rbmaison.test',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(verifySupabaseAccessToken(token, supabaseUrl, jwtSecret)).toEqual({
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'customer@rbmaison.test',
      projectRef: 'elvypbekopexhcojpwki',
    });
  });

  it('rejects tokens issued by a different Supabase project', () => {
    const token = signToken({
      iss: 'https://sbcyoaswsjfhhkypdniu.supabase.co/auth/v1',
      aud: 'authenticated',
      sub: '11111111-1111-1111-1111-111111111111',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(() => verifySupabaseAccessToken(token, supabaseUrl, jwtSecret)).toThrow(
      SupabaseAccessTokenError,
    );
  });

  it('rejects expired tokens', () => {
    const token = signToken({
      iss: `${supabaseUrl}/auth/v1`,
      aud: 'authenticated',
      sub: '11111111-1111-1111-1111-111111111111',
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    expect(() => verifySupabaseAccessToken(token, supabaseUrl, jwtSecret)).toThrow(
      /expired/i,
    );
  });
});
