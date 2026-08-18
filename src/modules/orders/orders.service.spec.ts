import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { AdminOrdersService } from './admin-orders.service';
import { CreateOrderDto } from './dto/order.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { mapSupabaseError } from '../products/supabase-error';
import {
  INSUFFICIENT_BALANCE_MESSAGE,
  ORDER_ALREADY_SETTLED_MESSAGE,
  lineSettlement,
  unitProfit,
  lineAmount,
} from './order.math';
import { RolesGuard } from '../auth/guards/roles.guard';

const customer: AuthenticatedUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
  accessToken: 'other-merchant-token',
};

const admin: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@rbmaison.test',
  role: 'admin',
  status: 'active',
  accessToken: 'admin-token',
};

const orderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const listingId = '66666666-6666-4666-8666-666666666666';
const productId = '22222222-2222-4222-8222-222222222222';
const variantId = '33333333-3333-4333-8333-333333333333';
const merchantId = '77777777-7777-4777-8777-777777777777';
const storeId = '99999999-9999-4999-8999-999999999999';

function placedOrder(status = 'pending') {
  return {
    id: orderId,
    customer_id: customer.id,
    merchant_id: merchantId,
    store_id: storeId,
    status,
    total_amount: '1000.00',
    currency: 'USD',
    created_at: '2026-08-18T00:00:00.000Z',
  };
}

function storeRow(overrides: Record<string, unknown> = {}) {
  return {
    order_id: orderId,
    store_id: storeId,
    customer_id: customer.id,
    customer_name: 'Cora Customer',
    customer_email: customer.email,
    status: 'pending',
    total_amount: '1000.00',
    currency: 'USD',
    created_at: '2026-08-18T00:00:00.000Z',
    item_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    listing_id: listingId,
    product_id: productId,
    product_name: 'Maison Tote',
    primary_image_url: 'https://cdn/tote.jpg',
    quantity: 1,
    sales_price: '1000.00',
    wholesale_price: '800.00',
    unit_profit: '200.00',
    merchant_profit: '200.00',
    amount_required: '800.00',
    ...overrides,
  };
}

describe('OrdersService', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('creates a customer order from listing + variant without client prices', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: placedOrder(), error: null }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new OrdersService({
      isConfigured: () => true,
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    const result = await service.create(customer, {
      merchantId,
      items: [{ listingId, variantId, quantity: 1 }],
    });

    expect(asUser).toHaveBeenCalledWith(customer.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('place_order', {
      p_merchant_id: merchantId,
      p_items: [
        {
          listing_id: listingId,
          product_id: undefined,
          variant_id: variantId,
          quantity: 1,
        },
      ],
    });
    expect(result.status).toBe('pending');
    expect(JSON.stringify(client.rpc.mock.calls[0][1])).not.toContain(
      'sales_price',
    );
  });

  it('rejects client wholesale_price and salesPrice on the order DTO', async () => {
    await expect(
      pipe.transform(
        {
          merchantId,
          items: [
            {
              listingId,
              variantId,
              quantity: 1,
              salesPrice: 1,
              wholesale_price: 1,
            },
          ],
        },
        { type: 'body', metatype: CreateOrderDto },
      ),
    ).rejects.toThrow();
  });

  it('shows the order in merchant store orders with wholesale, profit, and amount required', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [storeRow()], error: null }),
    };
    const service = new OrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const orders = await service.storeOrders(merchant);
    const order = orders[0];

    expect(client.rpc).toHaveBeenCalledWith('merchant_store_orders');
    expect(order.items[0].product_name).toBe('Maison Tote');
    expect(order.items[0].sales_price).toBe('1000.00');
    expect(order.items[0].wholesale_price).toBe('800.00');
    expect(order.items[0].profit).toBe('200.00');
    expect(order.items[0].amount_required).toBe('800.00');
    expect(order.wholesale_due).toBe(800);
    expect(unitProfit(1000, 800)).toBe(200);
    expect(lineAmount(800, 1)).toBe(800);
  });

  it('rejects confirmation when the merchant wallet has insufficient balance', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: INSUFFICIENT_BALANCE_MESSAGE, code: 'P0001' },
      }),
    };
    const notifications = {
      notifyPaymentRequired: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrdersService(
      {
        isConfigured: () => true,
        asUser: jest.fn().mockReturnValue(client),
      } as never,
      notifications as never,
    );

    await expect(
      service.confirmStoreOrder(merchant, orderId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.notifyPaymentRequired).toHaveBeenCalledWith(orderId);

    expect(
      mapSupabaseError(
        { message: 'Insufficient wallet balance', code: 'P0001' },
        'not found',
      ).message,
    ).toBe(INSUFFICIENT_BALANCE_MESSAGE);
  });

  it('confirms an order by debiting wholesale through the ledger RPC', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: placedOrder('paid'),
        error: null,
      }),
    };
    const service = new OrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.confirmStoreOrder(merchant, orderId);

    expect(client.rpc).toHaveBeenCalledWith('confirm_merchant_order', {
      p_order_id: orderId,
    });
    expect(result.status).toBe('paid');
  });

  it('moves a paid order to shipping', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: placedOrder('shipping'),
        error: null,
      }),
    };
    const service = new OrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.goForShipping(merchant, orderId);
    expect(client.rpc).toHaveBeenCalledWith('merchant_send_for_shipping', {
      p_order_id: orderId,
    });
    expect(result.status).toBe('shipping');
  });

  it('isolates merchants by caller JWT and never uses the admin client', async () => {
    const merchantClient = {
      rpc: jest.fn().mockResolvedValue({ data: [storeRow()], error: null }),
    };
    const otherClient = {
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const getAdminClient = jest.fn();
    const asUser = jest.fn((token: string) =>
      token === merchant.accessToken ? merchantClient : otherClient,
    );
    const service = new OrdersService({
      isConfigured: () => true,
      asUser,
      getAdminClient,
    } as never);

    const own = await service.storeOrders(merchant);
    const other = await service.storeOrders(otherMerchant);

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(asUser).toHaveBeenCalledWith(otherMerchant.accessToken);
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(merchantClient.rpc.mock.calls[0][1]).toBeUndefined();
    expect(own).toHaveLength(1);
    expect(other).toEqual([]);
  });

  it('strips wholesale and profit from customer order payloads', async () => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [placedOrder()],
        error: null,
      }),
    };
    builder.in.mockResolvedValue({
      data: [
        {
          id: 'item-1',
          order_id: orderId,
          product_id: productId,
          listing_id: listingId,
          variant_id: variantId,
          quantity: 1,
          sales_price: '1000.00',
          wholesale_price: '800.00',
          merchant_profit: '200.00',
        },
      ],
      error: null,
    });
    const client = {
      from: jest.fn().mockReturnValue(builder),
      rpc: jest.fn(),
    };
    const service = new OrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const orders = await service.myOrders(customer);
    expect(JSON.stringify(orders)).not.toContain('wholesale_price');
    expect(JSON.stringify(orders)).not.toContain('merchant_profit');
    expect(orders[0].items[0].sales_price).toBe('1000.00');
  });
});

describe('AdminOrdersService', () => {
  it('confirms delivery which releases profit after shipping', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: placedOrder('completed'),
        error: null,
      }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new AdminOrdersService({
      isConfigured: () => true,
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    const result = await service.confirmDelivery(admin, orderId);

    expect(asUser).toHaveBeenCalledWith(admin.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('admin_confirm_delivery', {
      p_order_id: orderId,
    });
    expect(result.status).toBe('completed');
  });

  it('completes a shipping order through wholesale settlement', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: placedOrder('completed'),
        error: null,
      }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new AdminOrdersService({
      isConfigured: () => true,
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    const result = await service.completeMerchantOrder(admin, orderId);

    expect(asUser).toHaveBeenCalledWith(admin.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('admin_complete_merchant_order', {
      p_order_id: orderId,
    });
    expect(result.status).toBe('completed');
    expect(lineSettlement(1000, 800, 1)).toEqual({
      wholesaleReturn: 800,
      profitRelease: 200,
      walletCredit: 1000,
    });
  });

  it('rejects duplicate settlement', async () => {
    expect(
      mapSupabaseError(
        { message: 'Order already settled', code: 'P0001' },
        'not found',
      ),
    ).toBeInstanceOf(ConflictException);
    expect(
      mapSupabaseError(
        { message: 'Order already settled', code: 'P0001' },
        'not found',
      ).message,
    ).toBe(ORDER_ALREADY_SETTLED_MESSAGE);
  });

  it('lists admin merchant orders without a client price field', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            order_id: orderId,
            store_id: storeId,
            store_name: 'Maison Atelier',
            merchant_id: merchantId,
            merchant_name: 'Maison Merchant',
            customer_id: customer.id,
            customer_name: 'Cora Customer',
            customer_email: customer.email,
            status: 'shipping',
            total_amount: '1000.00',
            currency: 'USD',
            created_at: '2026-08-18T00:00:00.000Z',
            amount_paid: '800.00',
            item_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            listing_id: listingId,
            product_id: productId,
            product_name: 'Luxury Woman Bag',
            primary_image_url: 'https://cdn/bag.jpg',
            quantity: 1,
            sales_price: '1000.00',
            wholesale_price: '800.00',
            unit_profit: '200.00',
            merchant_profit: '200.00',
            amount_required: '800.00',
          },
        ],
        error: null,
      }),
    };
    const service = new AdminOrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const orders = await service.searchMerchantOrders(admin, {
      storeId,
      merchantId,
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_merchant_orders', {
      p_order_id: undefined,
      p_store_id: storeId,
      p_merchant_id: merchantId,
      p_product_query: undefined,
    });
    expect(orders[0].items[0].product_name).toBe('Luxury Woman Bag');
    expect(orders[0].amount_paid).toBe('800.00');
    expect(orders[0].items[0].profit).toBe('200.00');
  });

  it('loads settlement history for an order', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          { type: 'order_payment', amount: '800.00', direction: 'debit' },
          { type: 'wholesale_return', amount: '800.00', direction: 'credit' },
          { type: 'profit_release', amount: '200.00', direction: 'credit' },
        ],
        error: null,
      }),
    };
    const service = new AdminOrdersService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const payments = await service.payments(admin, orderId);
    expect(client.rpc).toHaveBeenCalledWith('admin_order_payments', {
      p_order_id: orderId,
    });
    expect(payments[0].type).toBe('order_payment');
    expect(payments[1].type).toBe('wholesale_return');
    expect(payments[2].type).toBe('profit_release');
    expect(payments[2].amount).toBe('200.00');
  });

  it('blocks merchants from completing orders', () => {
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
