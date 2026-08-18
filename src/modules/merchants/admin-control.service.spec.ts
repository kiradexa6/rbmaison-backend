import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminStoresService } from './admin-stores.service';
import { AdminUsersService } from './admin-users.service';
import { MerchantStoreService } from './merchant-store.service';
import { StoreApplicationsService } from './store-applications.service';

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

const customer: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'customer@rbmaison.test',
  role: 'customer',
  status: 'active',
  accessToken: 'customer-token',
};

const storeId = '99999999-9999-4999-8999-999999999999';
const merchantId = '77777777-7777-4777-8777-777777777777';
const applicationId = '44444444-4444-4444-8444-444444444444';
const walletId = '33333333-3333-4333-8333-333333333333';

function serviceOf<T>(Ctor: new (supabase: never) => T, client: unknown): T {
  const asUser = jest.fn().mockReturnValue(client);
  return new Ctor({
    isConfigured: () => true,
    asUser,
    getAdminClient: jest.fn(),
  } as never);
}

describe('merchant application and admin approval', () => {
  it('creates a merchant application for a customer JWT', async () => {
    const application = {
      id: applicationId,
      user_id: customer.id,
      store_name: 'Maison Store',
      status: 'pending',
      documents: ['https://cdn/docs/license.pdf'],
    };
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: application, error: null }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new StoreApplicationsService({
      isConfigured: () => true,
      asUser,
    } as never);

    const result = await service.create(customer, {
      storeName: 'Maison Store',
      businessDescription: 'Luxury leather',
      country: 'France',
      documents: ['https://cdn/docs/license.pdf'],
    });

    expect(asUser).toHaveBeenCalledWith(customer.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('submit_merchant_application', {
      p_store_name: 'Maison Store',
      p_business_description: 'Luxury leather',
      p_country: 'France',
      p_documents: ['https://cdn/docs/license.pdf'],
    });
    expect(result).toEqual(application);
  });

  it('approves an application, creates the merchant account, and unlocks the merchant role', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            application_id: applicationId,
            merchant_id: merchantId,
            store_id: storeId,
            user_id: customer.id,
            role: 'merchant',
            store_name: 'Maison Store',
            status: 'approved',
          },
        ],
        error: null,
      }),
    };
    const service = serviceOf(AdminMerchantsService, client);

    const result = await service.approve(admin, applicationId);

    expect(client.rpc).toHaveBeenCalledWith(
      'admin_approve_merchant_application',
      { p_id: applicationId },
    );
    expect(result.role).toBe('merchant');
    expect(result.merchant_id).toBe(merchantId);
    expect(result.store_id).toBe(storeId);
    expect(result.status).toBe('approved');
  });

  it('rejects a pending application without creating a merchant account', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            application_id: applicationId,
            merchant_id: null,
            user_id: customer.id,
            status: 'rejected',
          },
        ],
        error: null,
      }),
    };
    const service = serviceOf(AdminMerchantsService, client);

    const result = await service.reject(admin, applicationId, 'Incomplete documents');

    expect(client.rpc).toHaveBeenCalledWith(
      'admin_reject_merchant_application',
      { p_id: applicationId, p_reason: 'Incomplete documents' },
    );
    expect(result.status).toBe('rejected');
    expect(result.merchant_id).toBeNull();
  });
});

describe('admin store search and shop control', () => {
  it('searches stores by Store ID, Merchant ID, name, and email', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [{ store_id: storeId }], error: null }),
    };
    const service = serviceOf(AdminStoresService, client);

    await service.search(admin, {
      storeId,
      merchantId,
      storeName: 'Maison',
      email: 'merchant@rbmaison.test',
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_search_stores', {
      p_store_id: storeId,
      p_merchant_id: merchantId,
      p_store_name: 'Maison',
      p_email: 'merchant@rbmaison.test',
    });
  });

  it('loads shop statistics from the shop_statistics RPC', async () => {
    const stats = {
      store_id: storeId,
      merchant_id: merchantId,
      total_products_listed: 3,
      active_products: 2,
      removed_products: 1,
      total_orders: 4,
      todays_orders: 1,
      completed_orders: 2,
      pending_orders: 1,
      total_sales: '280.00',
      todays_sales: '50.00',
      total_profit: '65.00',
      todays_profit: '40.00',
      total_followers: 0,
      credit_score: '100.00',
    };
    const client = {
      rpc: jest.fn((name: string) => {
        if (name === 'shop_statistics') {
          return Promise.resolve({ data: [stats], error: null });
        }
        if (name === 'shop_financials') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new MerchantStoreService({
      isConfigured: () => true,
      asUser,
    } as never);

    const result = await service.shopStatistics(merchant);

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('shop_statistics');
    expect(result.total_sales).toBe('280.00');
    expect(result.total_profit).toBe('65.00');
    expect(result.credit_score).toBe('100.00');
  });

  it('adjusts a store balance through an admin_adjustment ledger row', async () => {
    const tx = {
      id: '88888888-8888-4888-8888-888888888888',
      type: 'admin_adjustment',
      amount: '25.00',
      direction: 'credit',
    };
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: tx, error: null }),
    };
    const service = serviceOf(AdminStoresService, client);

    const result = await service.adjustBalance(admin, storeId, {
      amount: 25,
      direction: 'credit',
      reason: 'Goodwill credit',
      currency: 'USD',
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_adjust_store_wallet', {
      p_store_id: storeId,
      p_amount: 25,
      p_direction: 'credit',
      p_reason: 'Goodwill credit',
      p_currency: 'USD',
    });
    expect(result.type).toBe('admin_adjustment');
  });

  it('adjusts credit score and writes an append-only history row', async () => {
    const score = {
      id: '12121212-1212-4121-8121-121212121212',
      merchant_id: merchantId,
      score: '85.00',
      reason: 'Late shipments',
    };
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: score, error: null }),
    };
    const service = serviceOf(AdminStoresService, client);

    const result = await service.adjustCredit(admin, storeId, {
      score: 85,
      reason: 'Late shipments',
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_adjust_store_credit', {
      p_store_id: storeId,
      p_score: 85,
      p_reason: 'Late shipments',
    });
    expect(result.score).toBe('85.00');
  });

  it('reads admin activity logs after control-center actions', async () => {
    const logs = [
      {
        action: 'approve_merchant',
        target_type: 'merchant_applications',
        target_id: applicationId,
      },
    ];
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: logs, error: null }),
    };
    const service = serviceOf(AdminUsersService, client);

    const result = await service.activityLogs(admin, {
      action: 'approve_merchant',
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_search_activity_logs', {
      p_action: 'approve_merchant',
      p_target_type: undefined,
    });
    expect(result).toEqual(logs);
  });
});

describe('merchant isolation', () => {
  it('loads shop details with the merchant JWT and never accepts another store id', async () => {
    const details = {
      store_id: storeId,
      store_name: 'Maison Store',
      merchant_id: merchantId,
      owner_email: merchant.email,
    };
    const client = {
      rpc: jest.fn((name: string) => {
        if (name === 'shop_details') {
          return Promise.resolve({ data: [details], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new MerchantStoreService({
      isConfigured: () => true,
      asUser,
    } as never);

    const result = await service.shopDetails(merchant);

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('shop_details');
    expect(client.rpc.mock.calls.find((call) => call[0] === 'shop_details')?.[1]).toBeUndefined();
    expect(result.store_id).toBe(storeId);
  });

  it('blocks merchants from admin user, application, and store routes', () => {
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

    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });

  it('blocks customers from merchant shop details until the merchant role is assigned', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['merchant']),
    };
    const guard = new RolesGuard(reflector as never);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: customer }),
      }),
    };

    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });
});

describe('admin user management', () => {
  it('searches users by email, user id, store id, and merchant id', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const service = serviceOf(AdminUsersService, client);

    await service.search(admin, {
      email: 'customer@rbmaison.test',
      userId: customer.id,
      storeId,
      merchantId,
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_search_users', {
      p_email: 'customer@rbmaison.test',
      p_user_id: customer.id,
      p_store_id: storeId,
      p_merchant_id: merchantId,
      p_query: undefined,
    });
  });

  it('suspends and restores users through admin status RPCs', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { user_id: customer.id, status: 'suspended' },
        error: null,
      }),
    };
    const service = serviceOf(AdminUsersService, client);

    await service.suspend(admin, customer.id);
    await service.restore(admin, customer.id);

    expect(client.rpc).toHaveBeenCalledWith('admin_set_user_status', {
      p_user_id: customer.id,
      p_status: 'suspended',
    });
    expect(client.rpc).toHaveBeenCalledWith('admin_set_user_status', {
      p_user_id: customer.id,
      p_status: 'active',
    });
  });
});

describe('admin shop profile composition', () => {
  it('returns merchant details, products, orders, wallet, and transactions for a store', async () => {
    const details = [
      {
        store_id: storeId,
        store_name: 'Maison Store',
        merchant_id: merchantId,
        owner_user_id: merchant.id,
        owner_name: 'Ada Merchant',
        owner_email: merchant.email,
        owner_phone: '+15551212',
        country: 'France',
        verification_status: 'approved',
        merchant_status: 'active',
        wholesale_enabled: true,
      },
    ];
    const financials = [
      {
        currency: 'USD',
        wallet_id: walletId,
        wallet_balance: '40.00',
        total_deposits: '100.00',
        total_withdrawals: '25.00',
        order_payments: '80.00',
        profit_releases: '120.00',
        refunds: '10.00',
        wholesale_returns: '80.00',
      },
    ];
    const client = {
      rpc: jest.fn((name: string) => {
        if (name === 'shop_details') {
          return Promise.resolve({ data: details, error: null });
        }
        if (name === 'shop_statistics') {
          return Promise.resolve({
            data: [{ store_id: storeId, total_orders: 1 }],
            error: null,
          });
        }
        if (name === 'shop_financials') {
          return Promise.resolve({ data: financials, error: null });
        }
        if (name === 'store_shop_products') {
          return Promise.resolve({
            data: [
              {
                name: 'Maison Tote',
                category: 'Tote Bags',
                sales_price: '1000.00',
                profit: '200.00',
                status: 'active',
              },
            ],
            error: null,
          });
        }
        if (name === 'store_shop_orders') {
          return Promise.resolve({
            data: [
              {
                order_id: '10101010-1010-4010-8010-101010101010',
                product: 'Maison Tote',
                customer_email: customer.email,
                amount: '1000.00',
                wholesale_amount: '800.00',
                profit: '200.00',
                status: 'delivered',
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      from: jest.fn((table: string) => {
        const rows =
          table === 'wallet_transactions'
            ? [{ id: 'tx-1', type: 'deposit', wallet_id: walletId }]
            : [{ id: 'cs-1', merchant_id: merchantId, score: '100.00' }];
        return {
          select: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: rows, error: null }),
            }),
            eq: () => ({
              order: () => Promise.resolve({ data: rows, error: null }),
            }),
            order: () => Promise.resolve({ data: rows, error: null }),
          }),
        };
      }),
    };
    const service = serviceOf(AdminStoresService, client);

    const result = await service.getStore(admin, storeId);

    expect(result.store.store_id).toBe(storeId);
    expect(result.merchant.merchant_id).toBe(merchantId);
    expect(result.products[0].profit).toBe('200.00');
    expect(result.orders[0].wholesale_amount).toBe('800.00');
    expect(result.wallets[0].balance).toBe('40.00');
    expect(result.transactions).toHaveLength(1);
    expect(result.credit_scores[0].score).toBe('100.00');
  });
});
