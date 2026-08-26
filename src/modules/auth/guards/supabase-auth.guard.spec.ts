import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard';

describe('SupabaseAuthGuard', () => {
  it('loads profile through the service role after validating JWT', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-id', email: 'admin@rbmaison.test' } },
      error: null,
    });
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { role: 'admin', status: 'active' },
      error: null,
    });
    const from = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    const getAdminClient = jest.fn().mockReturnValue({
      auth: { getUser },
      from,
    });

    const guard = new SupabaseAuthGuard({
      isConfigured: () => true,
      getPublicUrl: () => 'https://sbcyoaswsjfhhkypdniu.supabase.co',
      getAdminClient,
      asUser: jest.fn(),
    } as never);

    const request = {
      headers: { authorization: 'Bearer valid-token' },
      method: 'GET',
      url: '/api/v1/admin/users',
      ip: '127.0.0.1',
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getUser).toHaveBeenCalledWith('valid-token');
    expect(from).toHaveBeenCalledWith('profiles');
    expect(request.user).toEqual(
      expect.objectContaining({
        id: 'user-id',
        role: 'admin',
        accessToken: 'valid-token',
      }),
    );
  });

  it('rejects requests without a token', async () => {
    const guard = new SupabaseAuthGuard({
      isConfigured: () => true,
      getPublicUrl: () => 'https://sbcyoaswsjfhhkypdniu.supabase.co',
      getAdminClient: jest.fn(),
      asUser: jest.fn(),
    } as never);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          method: 'GET',
          url: '/api/v1/admin/users',
          ip: '127.0.0.1',
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects JWTs issued by a different Supabase project', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    });
    const guard = new SupabaseAuthGuard({
      isConfigured: () => true,
      getPublicUrl: () => 'https://sbcyoaswsjfhhkypdniu.supabase.co',
      getAdminClient: () => ({ auth: { getUser } }),
      asUser: jest.fn(),
    } as never);

    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://elvypbekopexhcojpwki.supabase.co/auth/v1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.sig`;

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${token}` },
          method: 'POST',
          url: '/api/v1/orders/order-id/stripe/checkout',
          ip: '127.0.0.1',
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(getUser).toHaveBeenCalledWith(token);
  });
});
