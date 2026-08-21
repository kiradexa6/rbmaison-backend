import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

const customer: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'customer@rbmaison.test',
  role: 'customer',
  status: 'active',
  accessToken: 'customer-token',
};

function profileClient(role: string, status = 'active') {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { role, status },
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe('AuthService', () => {
  it('registers through the anon client, never the service role', async () => {
    const anon = {
      auth: {
        signUp: jest.fn().mockResolvedValue({
          data: {
            user: { id: customer.id, email: customer.email },
            session: null,
          },
          error: null,
        }),
      },
    };
    const getAdminClient = jest.fn().mockReturnValue(profileClient('customer'));
    const service = new AuthService({
      isConfigured: () => true,
      getAnonClient: () => anon,
      getAdminClient,
      asUser: jest.fn(),
    } as never);

    const result = await service.signup({
      email: customer.email,
      password: 'correct-horse-battery-staple',
    });

    expect(anon.auth.signUp).toHaveBeenCalledWith({
      email: customer.email,
      password: 'correct-horse-battery-staple',
    });
    expect(result.user).toEqual(
      expect.objectContaining({ id: customer.id, role: 'customer' }),
    );
    expect(result.session).toBeNull();
  });

  it('logs in through the anon client and returns role in the session payload', async () => {
    const anon = {
      auth: {
        signInWithPassword: jest.fn().mockResolvedValue({
          data: {
            user: { id: customer.id, email: customer.email },
            session: {
              access_token: 'access',
              refresh_token: 'refresh',
              expires_at: 1_700_000_000,
            },
          },
          error: null,
        }),
      },
    };
    const getAdminClient = jest.fn().mockReturnValue(profileClient('admin'));
    const service = new AuthService({
      isConfigured: () => true,
      getAnonClient: () => anon,
      getAdminClient,
      asUser: jest.fn(),
    } as never);

    const result = await service.login({
      email: customer.email,
      password: 'correct-horse-battery-staple',
    });

    expect(getAdminClient).toHaveBeenCalled();
    expect(result.session.accessToken).toBe('access');
    expect(result.user).toEqual(
      expect.objectContaining({ email: customer.email, role: 'admin' }),
    );
  });

  it('refreshes sessions and returns a new access token with role', async () => {
    const anon = {
      auth: {
        refreshSession: jest.fn().mockResolvedValue({
          data: {
            user: { id: customer.id, email: customer.email },
            session: {
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_at: 1_800_000_000,
            },
          },
          error: null,
        }),
      },
    };
    const service = new AuthService({
      isConfigured: () => true,
      getAnonClient: () => anon,
      getAdminClient: jest.fn().mockReturnValue(profileClient('admin')),
      asUser: jest.fn(),
    } as never);

    const result = await service.refresh({ refreshToken: 'refresh' });

    expect(anon.auth.refreshSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
    });
    expect(result.session.accessToken).toBe('new-access');
    expect(result.user.role).toBe('admin');
  });

  it('rejects invalid login credentials as unauthorized', async () => {
    const service = new AuthService({
      isConfigured: () => true,
      getAnonClient: () => ({
        auth: {
          signInWithPassword: jest.fn().mockResolvedValue({
            data: { user: null, session: null },
            error: { message: 'Invalid login credentials' },
          }),
        },
      }),
      getAdminClient: jest.fn(),
      asUser: jest.fn(),
    } as never);

    await expect(
      service.login({ email: customer.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps duplicate signup to a conflict', async () => {
    const service = new AuthService({
      isConfigured: () => true,
      getAnonClient: () => ({
        auth: {
          signUp: jest.fn().mockResolvedValue({
            data: { user: null, session: null },
            error: { message: 'User already registered' },
          }),
        },
      }),
      getAdminClient: jest.fn(),
      asUser: jest.fn(),
    } as never);

    await expect(
      service.signup({
        email: customer.email,
        password: 'correct-horse-battery-staple',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs out with the caller JWT, not the service role', async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const asUser = jest.fn().mockReturnValue({ auth: { signOut } });
    const getAdminClient = jest.fn();
    const service = new AuthService({
      isConfigured: () => true,
      getAnonClient: jest.fn(),
      getAdminClient,
      asUser,
    } as never);

    await expect(service.logout(customer)).resolves.toEqual({
      loggedOut: true,
    });
    expect(asUser).toHaveBeenCalledWith(customer.accessToken);
    expect(getAdminClient).not.toHaveBeenCalled();
  });
});
