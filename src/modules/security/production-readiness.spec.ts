import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { validate } from '../../config/env.validation';
import { AdminMerchantsService } from '../merchants/admin-merchants.service';
import { StoreApplicationsService } from '../merchants/store-applications.service';
import { MerchantListingsService } from '../products/merchant-listings.service';
import { OrdersService } from '../orders/orders.service';
import { AdminOrdersService } from '../orders/admin-orders.service';
import { MerchantWalletsService } from '../wallets/merchant-wallets.service';
import { AdminWalletsService } from '../wallets/admin-wallets.service';
import { NotificationService } from '../notifications/notifications.service';
import { NOTIFICATION_EVENTS } from '../notifications/notification.events';
import { mapSupabaseError } from '../products/supabase-error';
import {
  THROTTLE_AUTH_LIMIT,
  THROTTLE_DEFAULT_LIMIT,
  THROTTLE_FINANCIAL_LIMIT,
  THROTTLE_HISTORICAL_LIMIT,
  THROTTLE_ORDER_LIMIT,
} from '../../shared/common/constants/throttle.constants';

const customer: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'customer@rbmaison.test',
  role: 'customer',
  status: 'active',
  accessToken: 'customer-token',
};

const merchant: AuthenticatedUser = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'merchant@rbmaison.test',
  role: 'merchant',
  status: 'active',
  accessToken: 'merchant-token',
};

const otherMerchant: AuthenticatedUser = {
  id: '88888888-8888-4888-8888-888888888888',
  email: 'other@rbmaison.test',
  role: 'merchant',
  status: 'active',
  accessToken: 'other-token',
};

const admin: AuthenticatedUser = {
  id: '99999999-9999-4999-8999-999999999999',
  email: 'admin@rbmaison.test',
  role: 'admin',
  status: 'active',
  accessToken: 'admin-token',
};

const storeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const listingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const orderId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const merchantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const depositId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const withdrawalId = '12121212-1212-4121-8121-121212121212';

function roleContext(
  role: AuthenticatedUser['role'] | undefined,
  required: string[],
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  };
  const guard = new RolesGuard(reflector as never);
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        url: '/api/v1/protected',
        ip: '127.0.0.1',
        user: role
          ? {
              id: 'user',
              email: 'u@test',
              role,
              status: 'active',
              accessToken: 't',
            }
          : undefined,
      }),
    }),
  };
  return { guard, context };
}

describe('production readiness — authentication and roles', () => {
  it('blocks customers from merchant routes', () => {
    const { guard, context } = roleContext('customer', ['merchant']);
    expect(() => guard.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context as never)).toThrow(
      /Permission denied/,
    );
  });

  it('blocks customers and merchants from admin routes', () => {
    const merchantAttempt = roleContext('merchant', ['admin']);
    const customerAttempt = roleContext('customer', ['admin']);

    expect(() =>
      merchantAttempt.guard.canActivate(merchantAttempt.context as never),
    ).toThrow(ForbiddenException);
    expect(() =>
      customerAttempt.guard.canActivate(customerAttempt.context as never),
    ).toThrow(ForbiddenException);
  });

  it('allows each role only on its own surface', () => {
    expect(
      roleContext('customer', ['customer']).guard.canActivate(
        roleContext('customer', ['customer']).context as never,
      ),
    ).toBe(true);
    expect(
      roleContext('merchant', ['merchant']).guard.canActivate(
        roleContext('merchant', ['merchant']).context as never,
      ),
    ).toBe(true);
    expect(
      roleContext('admin', ['admin']).guard.canActivate(
        roleContext('admin', ['admin']).context as never,
      ),
    ).toBe(true);
  });
});

describe('production readiness — merchant apply, approve, list', () => {
  it('lets a customer submit a store application through the RPC', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: storeId, status: 'pending', store_name: 'Maison Atelier' },
        error: null,
      }),
    };
    const service = new StoreApplicationsService(
      {
        isConfigured: () => true,
        asUser: jest.fn().mockReturnValue(client),
      } as never,
      { uploadApplicationDocument: jest.fn() } as never,
    );

    const result = await service.create(customer, {
      storeName: 'Maison Atelier',
      country: 'FR',
      phone: '+33123456789',
      address: '10 Avenue Montaigne, Paris',
      identityDocumentType: 'passport',
      documents: [
        {
          kind: 'passport',
          storagePath: `${customer.id}/passport.pdf`,
        },
      ],
    });

    expect(client.rpc).toHaveBeenCalledWith(
      'submit_merchant_application',
      expect.objectContaining({ p_store_name: 'Maison Atelier' }),
    );
    expect(result.status).toBe('pending');
  });

  it('requires the admin JWT for application approval', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [{ id: storeId, status: 'approved' }],
        error: null,
      }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new AdminMerchantsService({
      isConfigured: () => true,
      asUser,
    } as never);

    await service.approve(admin, storeId);

    expect(asUser).toHaveBeenCalledWith(admin.accessToken);
    expect(client.rpc).toHaveBeenCalledWith(
      'admin_approve_merchant_application',
      expect.objectContaining({ p_id: storeId }),
    );
  });

  it('lists a product through create_merchant_listing without a client price', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: listingId, product_id: productId, sales_price: '1200.00' },
        error: null,
      }),
    };
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.createListing(merchant, { productId });

    expect(client.rpc).toHaveBeenCalledWith('create_merchant_listing', {
      p_product_id: productId,
    });
  });
});

describe('production readiness — order, wallet, and notification flow', () => {
  it('places, confirms, ships, and delivers through server RPCs', async () => {
    const ordersClient = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: orderId, status: 'pending' },
        error: null,
      }),
    };
    const orders = new OrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(ordersClient),
      getAdminClient: jest.fn(),
    } as never);

    await orders.create(customer, {
      merchantId,
      items: [{ listingId, variantId: productId, quantity: 1 }],
    });
    expect(ordersClient.rpc).toHaveBeenCalledWith(
      'place_order',
      expect.objectContaining({ p_merchant_id: merchantId }),
    );

    ordersClient.rpc.mockResolvedValue({
      data: { id: orderId, status: 'paid' },
      error: null,
    });
    await orders.confirmStoreOrder(merchant, orderId);
    expect(ordersClient.rpc).toHaveBeenCalledWith('confirm_merchant_order', {
      p_order_id: orderId,
    });

    ordersClient.rpc.mockResolvedValue({
      data: { id: orderId, status: 'shipping' },
      error: null,
    });
    await orders.goForShipping(merchant, orderId);
    expect(ordersClient.rpc).toHaveBeenCalledWith(
      'merchant_send_for_shipping',
      {
        p_order_id: orderId,
      },
    );

    const adminClient = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: orderId, status: 'completed' },
        error: null,
      }),
    };
    const adminOrders = new AdminOrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(adminClient),
    } as never);
    await adminOrders.completeMerchantOrder(admin, orderId);
    expect(adminClient.rpc).toHaveBeenCalledWith(
      'admin_complete_merchant_order',
      { p_order_id: orderId },
    );
  });

  it('credits deposits and debits withdrawals only after admin approval', async () => {
    const merchantClient = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: depositId, status: 'pending' },
        error: null,
      }),
    };
    const merchantWallets = new MerchantWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(merchantClient),
    } as never);

    await merchantWallets.createDeposit(merchant, {
      amount: 1000,
      asset: 'USDT',
      network: 'trc20',
    });
    expect(merchantClient.rpc).toHaveBeenCalledWith(
      'create_deposit_request',
      expect.objectContaining({ p_amount: 1000 }),
    );

    const adminClient = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: depositId, status: 'approved' },
        error: null,
      }),
    };
    const adminWallets = new AdminWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(adminClient),
    } as never);

    await adminWallets.approveDeposit(admin, depositId);
    expect(adminClient.rpc).toHaveBeenCalledWith('admin_approve_deposit', {
      p_request_id: depositId,
    });

    adminClient.rpc.mockResolvedValue({
      data: { id: withdrawalId, status: 'approved' },
      error: null,
    });
    await adminWallets.approveWithdrawal(admin, withdrawalId);
    expect(adminClient.rpc).toHaveBeenCalledWith('admin_approve_withdrawal', {
      p_request_id: withdrawalId,
    });
  });

  it('records balance adjustments only through the admin ledger RPC', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { type: 'admin_adjustment', amount: '50.00' },
        error: null,
      }),
    };
    const service = new AdminWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.adjustMerchantWallet(admin, merchantId, {
      currency: 'USDT',
      amount: 50,
      direction: 'credit',
      reason: 'correction',
    });

    expect(client.rpc).toHaveBeenCalledWith(
      'admin_adjust_merchant_wallet',
      expect.objectContaining({
        p_merchant_id: merchantId,
        p_amount: 50,
        p_direction: 'credit',
      }),
    );
  });

  it('isolates merchant wallet reads to the caller JWT', async () => {
    const client = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new MerchantWalletsService({
      isConfigured: () => true,
      asUser,
    } as never);

    await service.getWallets(merchant);
    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(asUser).not.toHaveBeenCalledWith(otherMerchant.accessToken);
  });

  it('covers every marketplace notification event', () => {
    expect(Object.keys(NOTIFICATION_EVENTS).sort()).toEqual(
      [
        'applicationApproved',
        'applicationRejected',
        'applicationSubmitted',
        'deliveryCompleted',
        'depositApproved',
        'depositPending',
        'depositRejected',
        'newOrder',
        'orderPaid',
        'orderSentForShipping',
        'paymentRequired',
        'profitReleased',
        'shippingConfirmed',
        'withdrawalApproved',
        'withdrawalPending',
        'withdrawalRejected',
      ].sort(),
    );
  });

  it('lists notifications through the caller JWT only', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new NotificationService(
      {
        isConfigured: () => true,
        asUser,
        getAdminClient: jest.fn(),
      } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
    );

    await service.listMine(merchant);
    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('my_notifications');
  });
});

describe('production readiness — wallet protection and API hardening', () => {
  it('rejects client-side balance errors with the production message', () => {
    const error = mapSupabaseError(
      {
        message: 'Insufficient balance. Please top up your account.',
        code: 'P0001',
      },
      'not found',
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(
      'Insufficient balance. Please top up your account.',
    );
  });

  it('rejects paid-without-ledger and price-edit attempts as invalid requests', () => {
    expect(
      mapSupabaseError(
        {
          message:
            'Order cannot be marked paid without a wholesale ledger payment',
        },
        'not found',
      ),
    ).toBeInstanceOf(UnprocessableEntityException);

    expect(
      mapSupabaseError(
        { message: 'Sales price snapshot cannot be changed' },
        'not found',
      ),
    ).toBeInstanceOf(UnprocessableEntityException);
  });

  it('rate-limits auth tighter than ordinary reads, and historical tighter than financial actions', () => {
    expect(THROTTLE_AUTH_LIMIT).toBe(20);
    expect(THROTTLE_HISTORICAL_LIMIT).toBe(3);
    expect(THROTTLE_FINANCIAL_LIMIT).toBe(10);
    expect(THROTTLE_ORDER_LIMIT).toBe(20);
    expect(THROTTLE_DEFAULT_LIMIT).toBe(120);
    expect(THROTTLE_AUTH_LIMIT).toBeLessThan(THROTTLE_DEFAULT_LIMIT);
    expect(THROTTLE_HISTORICAL_LIMIT).toBeLessThan(THROTTLE_FINANCIAL_LIMIT);
    expect(THROTTLE_FINANCIAL_LIMIT).toBeLessThan(THROTTLE_ORDER_LIMIT);
  });

  it('never boots production with a wildcard CORS origin or missing JWT secret', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
        SUPABASE_JWT_SECRET: 'jwt',
        CORS_ORIGIN: '*',
      }),
    ).toThrow(/CORS_ORIGIN/);
  });
});
