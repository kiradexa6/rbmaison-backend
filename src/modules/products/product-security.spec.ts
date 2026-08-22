import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CatalogueService } from './catalogue.service';
import { mapSupabaseError } from './supabase-error';
import { PUBLIC_PRODUCT_HIDDEN_FIELDS } from './product.math';

describe('product security', () => {
  it('strips wholesale, merchant, and internal inventory fields from public payloads', () => {
    const service = Object.create(
      CatalogueService.prototype,
    ) as CatalogueService;
    const payload = {
      name: 'Tote',
      price: 1200,
      wholesale_price: 960,
      merchant_id: 'secret',
      merchant_profit: 240,
      quantity: 12,
      reserved_quantity: 2,
      available_quantity: 10,
      images: [{ imageUrl: 'https://cdn/x.jpg', wholesale_price: 1 }],
    };

    const publicPayload = service.stripHidden(payload);

    for (const field of PUBLIC_PRODUCT_HIDDEN_FIELDS) {
      expect(publicPayload).not.toHaveProperty(field);
    }
    expect(publicPayload.images[0]).not.toHaveProperty('wholesale_price');
    expect(publicPayload.name).toBe('Tote');
    expect(publicPayload.price).toBe(1200);
  });

  it('maps RLS denials to ForbiddenException', () => {
    expect(
      mapSupabaseError(
        {
          message: 'new row violates row-level security policy',
          code: '42501',
        },
        'not found',
      ),
    ).toBeInstanceOf(ForbiddenException);
  });

  it('blocks non-admin roles from admin routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['admin']),
    };
    const guard = new RolesGuard(reflector as never);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: 'merchant' } }),
      }),
    };

    expect(() => guard.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
  });

  it('allows admin role on admin routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['admin']),
    };
    const guard = new RolesGuard(reflector as never);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: 'ADMIN' } }),
      }),
    };

    expect(guard.canActivate(context as never)).toBe(true);
  });
});
