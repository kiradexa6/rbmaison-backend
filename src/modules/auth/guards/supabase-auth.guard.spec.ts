import { createHmac } from 'node:crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard';

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

function buildGuard(options: {
  profile?: { role: string; status: string } | null;
  profileError?: { message: string } | null;
}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: options.profile ?? null,
    error: options.profileError ?? null,
  });
  const from = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ maybeSingle }),
    }),
  });
  const getAdminClient = jest.fn().mockReturnValue({ from });

  const guard = new SupabaseAuthGuard(
    {
      get: jest.fn((key: string) => {
        if (key === 'supabase.jwtSecret') {
          return jwtSecret;
        }
        return undefined;
      }),
    } as never,
    {
      isConfigured: () => true,
      getPublicUrl: () => supabaseUrl,
      getAdminClient,
      asUser: jest.fn(),
    } as never,
  );

  return { guard, from, maybeSingle };
}

describe('SupabaseAuthGuard', () => {
  it('loads profile after validating a Supabase JWT locally', async () => {
    const token = signToken({
      iss: `${supabaseUrl}/auth/v1`,
      aud: 'authenticated',
      sub: 'user-id',
      email: 'customer@rbmaison.test',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const { guard, from } = buildGuard({
      profile: { role: 'customer', status: 'active' },
    });

    const request = {
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
      originalUrl: '/api/v1/orders/order-id/stripe/checkout',
      url: '/api/v1/orders/order-id/stripe/checkout',
      ip: '127.0.0.1',
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('profiles');
    expect(request.user).toEqual(
      expect.objectContaining({
        id: 'user-id',
        role: 'customer',
        accessToken: token,
      }),
    );
  });

  it('rejects requests without a token', async () => {
    const { guard } = buildGuard({});
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          method: 'POST',
          originalUrl: '/api/v1/orders/order-id/stripe/checkout',
          url: '/api/v1/orders/order-id/stripe/checkout',
          ip: '127.0.0.1',
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects JWTs issued by a different Supabase project before profile lookup', async () => {
    const token = signToken({
      iss: 'https://sbcyoaswsjfhhkypdniu.supabase.co/auth/v1',
      aud: 'authenticated',
      sub: 'user-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const { guard, from } = buildGuard({
      profile: { role: 'customer', status: 'active' },
    });

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${token}` },
          method: 'POST',
          originalUrl: '/api/v1/orders/order-id/stripe/checkout',
          url: '/api/v1/orders/order-id/stripe/checkout',
          ip: '127.0.0.1',
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(from).not.toHaveBeenCalled();
  });
});
