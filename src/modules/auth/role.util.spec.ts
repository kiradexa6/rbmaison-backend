import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { isAdminRole, normalizeUserRole, roleMatches } from './role.util';

describe('role.util', () => {
  it('normalizes admin role case-insensitively', () => {
    expect(normalizeUserRole('ADMIN')).toBe('admin');
    expect(isAdminRole('Admin')).toBe(true);
  });

  it('matches allowed roles case-insensitively', () => {
    expect(roleMatches('ADMIN', ['admin'])).toBe(true);
    expect(roleMatches('merchant', ['admin'])).toBe(false);
  });
});

describe('RolesGuard admin messaging', () => {
  it('uses administrator message for admin-only routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['admin']),
    };
    const guard = new RolesGuard(reflector as never);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: 'merchant' },
          method: 'POST',
          url: '/admin/stores/x/unlock',
        }),
      }),
    };

    try {
      guard.canActivate(context as never);
      fail('expected ForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'Administrator access required.',
      );
    }
  });
});
