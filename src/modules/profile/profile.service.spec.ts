import { NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@rbmaison.test',
  role: 'customer' as const,
  status: 'active' as const,
  accessToken: 'token',
};

describe('ProfileService', () => {
  it('returns the authenticated profile from profiles table', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { user_id: user.id, email: user.email, role: 'customer' },
      error: null,
    });
    const service = new ProfileService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle }),
          }),
        }),
      }),
    } as never);

    const profile = await service.getMine(user);
    expect(profile.user_id).toBe(user.id);
  });

  it('updates editable profile fields through RLS', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { user_id: user.id, full_name: 'Maison User', phone: '+33123456789' },
      error: null,
    });
    const service = new ProfileService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ maybeSingle }),
            }),
          }),
        }),
      }),
    } as never);

    const profile = await service.updateMine(user, {
      fullName: 'Maison User',
      phone: '+33123456789',
    });
    expect(profile.full_name).toBe('Maison User');
  });

  it('throws when profile is missing', async () => {
    const service = new ProfileService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as never);

    await expect(service.getMine(user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
