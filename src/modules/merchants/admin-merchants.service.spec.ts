import { AdminMerchantsService } from './admin-merchants.service';
import { MerchantStoreService } from './merchant-store.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ForbiddenException } from '@nestjs/common';

const admin: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@rbmaison.test',
  role: 'admin',
  status: 'active',
  accessToken: 'admin-token',
};

const merchant: AuthenticatedUser = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'merchant@rbmaison.test',
  role: 'merchant',
  status: 'active',
  accessToken: 'merchant-token',
};

const storeId = '99999999-9999-4999-8999-999999999999';
const merchantId = '77777777-7777-4777-8777-777777777777';

describe('AdminMerchantsService', () => {
  it('searches merchants by Store ID', async () => {
    const profile = {
      merchant_id: merchantId,
      store_id: storeId,
      store_name: 'Maison Store',
      owner_name: 'Ada Merchant',
      owner_email: 'merchant@rbmaison.test',
      verification_status: 'approved',
      account_status: 'active',
      wholesale_enabled: true,
    };
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [profile], error: null }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new AdminMerchantsService({
      isConfigured: () => true,
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    const result = await service.searchMerchants(admin, { storeId });

    expect(asUser).toHaveBeenCalledWith(admin.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('admin_search_merchants', {
      p_store_id: storeId,
      p_query: undefined,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        ...profile,
        id: merchantId,
        record_type: 'merchant',
      },
    ]);
  });

  it('includes pending applications in merchant search for Control Center', async () => {
    const application = {
      application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      applicant_name: 'New Seller',
      applicant_email: 'seller@rbmaison.test',
      store_name: 'Pending Store',
      store_id: null,
      merchant_id: null,
      status: 'pending',
      submitted_at: '2026-08-01T00:00:00.000Z',
      country: 'FR',
    };
    const merchantRow = {
      merchant_id: merchantId,
      store_id: storeId,
      store_name: 'Maison Store',
      owner_name: 'Ada Merchant',
      owner_email: 'merchant@rbmaison.test',
      verification_status: 'approved',
      account_status: 'active',
      wholesale_enabled: true,
    };
    const client = {
      rpc: jest
        .fn()
        .mockResolvedValueOnce({ data: [merchantRow], error: null })
        .mockResolvedValueOnce({ data: [application], error: null }),
    };
    const service = new AdminMerchantsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.searchMerchants(admin, {});

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'admin_search_merchants', {
      p_store_id: undefined,
      p_query: undefined,
    });
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'admin_search_applications', {
      p_status: undefined,
      p_query: undefined,
    });
    expect(result[0]).toMatchObject({
      id: application.application_id,
      record_type: 'application',
      store_name: 'Pending Store',
    });
    expect(result[1]).toMatchObject({
      id: merchantId,
      record_type: 'merchant',
    });
  });

  it('searches listings by Store ID, merchant, product, and status', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const service = new AdminMerchantsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.searchListings(admin, {
      storeId,
      merchant: 'Ada',
      product: 'Tote',
      status: 'active',
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_search_listings', {
      p_store_id: storeId,
      p_merchant_id: undefined,
      p_merchant_query: 'Ada',
      p_product_query: 'Tote',
      p_status: 'active',
    });
  });

  it('disables and removes listings through admin RPCs', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: {
          id: '66666666-6666-4666-8666-666666666666',
          status: 'inactive',
        },
        error: null,
      }),
    };
    const service = new AdminMerchantsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.disableListing(admin, '66666666-6666-4666-8666-666666666666');
    await service.removeListing(admin, '66666666-6666-4666-8666-666666666666');
    await service.setWholesaleAccess(admin, merchantId, false);

    expect(client.rpc).toHaveBeenCalledWith('admin_set_listing_status', {
      p_listing_id: '66666666-6666-4666-8666-666666666666',
      p_status: 'inactive',
    });
    expect(client.rpc).toHaveBeenCalledWith('admin_set_listing_status', {
      p_listing_id: '66666666-6666-4666-8666-666666666666',
      p_status: 'removed',
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'admin_set_merchant_wholesale_access',
      { p_merchant_id: merchantId, p_enabled: false },
    );
  });

  it('blocks merchants from admin merchant routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['admin']),
    };
    const guard = new RolesGuard(reflector as never);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: merchant }),
      }),
    };

    expect(() => guard.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
  });
});

describe('MerchantStoreService', () => {
  it('returns the caller store profile through the merchant JWT', async () => {
    const profile = {
      merchant_id: merchantId,
      store_id: storeId,
      store_name: 'Maison Store',
      owner_name: 'Ada Merchant',
      owner_email: 'merchant@rbmaison.test',
      owner_phone: '+15551212',
      verification_status: 'approved',
      account_status: 'active',
      wholesale_enabled: true,
    };
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [profile], error: null }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new MerchantStoreService({
      isConfigured: () => true,
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    const result = await service.getStore(merchant);

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('merchant_store_profile');
    expect(result).toEqual(profile);
  });
});
