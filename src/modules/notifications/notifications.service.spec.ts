import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  ADMIN_EVENT_TITLES,
  NOTIFICATION_EVENTS,
} from './notification.events';
import { NotificationService } from './notifications.service';

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

const otherMerchant: AuthenticatedUser = {
  id: '88888888-8888-4888-8888-888888888888',
  email: 'other@rbmaison.test',
  role: 'merchant',
  status: 'active',
  accessToken: 'other-token',
};

const orderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const notificationId = '12121212-1212-4121-8121-121212121212';

function notificationRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: notificationId,
    user_id: merchant.id,
    type: 'new_order',
    title: 'New Order',
    message: 'You have received a new store order.',
    data: { order_id: orderId, product: 'Maison Tote', amount: '1000.00' },
    read_status: 'unread',
    created_at: '2026-08-18T00:00:00.000Z',
    read_at: null,
    ...overrides,
  };
}

function serviceWithClient(
  client: unknown,
  adminClient: unknown = { rpc: jest.fn() },
) {
  return new NotificationService(
    {
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as never,
    { send: jest.fn() } as never,
    { send: jest.fn() } as never,
    { send: jest.fn() } as never,
  );
}

describe('notification events from real system actions', () => {
  it('creates application submitted, approved, and rejected copy from those events', () => {
    expect(NOTIFICATION_EVENTS.applicationSubmitted).toMatchObject({
      type: 'merchant_application',
      title: 'Application Submitted',
    });
    expect(NOTIFICATION_EVENTS.applicationApproved).toMatchObject({
      type: 'merchant_approved',
      title: 'Store Approved',
    });
    expect(NOTIFICATION_EVENTS.applicationRejected).toMatchObject({
      type: 'merchant_rejected',
      title: 'Store Application Rejected',
    });
  });

  it('creates new order, shipping, delivery, and profit-release copy from order events', () => {
    expect(NOTIFICATION_EVENTS.newOrder).toMatchObject({
      type: 'new_order',
      title: 'New Order',
      message: 'New order received',
      audience: 'merchant',
    });
    expect(NOTIFICATION_EVENTS.orderPaid.message).toBe(
      'Order confirmed and wholesale payment completed',
    );
    expect(NOTIFICATION_EVENTS.shippingConfirmed).toMatchObject({
      type: 'shipping_confirmed',
      title: 'Merchant Order Waiting For Confirmation',
      audience: 'admin',
    });
    expect(NOTIFICATION_EVENTS.orderSentForShipping).toMatchObject({
      type: 'shipping_confirmed',
      message: 'Order sent for shipping',
      audience: 'merchant',
    });
    expect(NOTIFICATION_EVENTS.deliveryCompleted).toMatchObject({
      type: 'delivery_completed',
      title: 'Order Completed',
      message: 'Order completed. Wholesale returned and profit released.',
    });
    expect(NOTIFICATION_EVENTS.profitReleased).toMatchObject({
      type: 'profit_released',
      title: 'Profit Released',
    });
    expect(NOTIFICATION_EVENTS.profitReleased.message).toContain(
      'Wholesale returned and profit released',
    );
  });

  it('creates deposit and withdrawal notifications for merchant and admin', () => {
    expect(NOTIFICATION_EVENTS.depositPending.audience).toBe('merchant+admin');
    expect(ADMIN_EVENT_TITLES.newDeposit).toBe('New Deposit Request');
    expect(NOTIFICATION_EVENTS.depositApproved.title).toBe('Deposit Approved');
    expect(NOTIFICATION_EVENTS.withdrawalPending.audience).toBe(
      'merchant+admin',
    );
    expect(ADMIN_EVENT_TITLES.newWithdrawal).toBe('New Withdrawal Request');
    expect(NOTIFICATION_EVENTS.withdrawalApproved.title).toBe(
      'Withdrawal Approved',
    );
    expect(NOTIFICATION_EVENTS.withdrawalRejected.title).toBe(
      'Withdrawal Rejected',
    );
  });

  it('maps admin queue events including suspicious payment failures', () => {
    expect(ADMIN_EVENT_TITLES.newApplication).toBe('New Merchant Application');
    expect(ADMIN_EVENT_TITLES.shipping).toBe(
      'Merchant Order Waiting For Confirmation',
    );
    expect(ADMIN_EVENT_TITLES.suspicious).toBe('Suspicious Activity');
  });
});

describe('NotificationService', () => {
  it('creates in-app notifications through the backend create_notification RPC', async () => {
    const adminClient = {
      rpc: jest.fn().mockResolvedValue({
        data: notificationRow({ type: 'merchant_application' }),
        error: null,
      }),
    };
    const service = serviceWithClient({ rpc: jest.fn() }, adminClient);

    await service.sendInApp({
      userId: merchant.id,
      type: 'merchant_application',
      title: 'Application Submitted',
      message:
        'Your store application has been submitted and is waiting for review.',
    });

    expect(adminClient.rpc).toHaveBeenCalledWith('create_notification', {
      p_user_id: merchant.id,
      p_type: 'merchant_application',
      p_title: 'Application Submitted',
      p_message:
        'Your store application has been submitted and is waiting for review.',
      p_data: {},
    });
  });

  it('persists payment-required after a failed wholesale debit', async () => {
    const adminClient = {
      rpc: jest.fn().mockResolvedValue({ data: notificationRow(), error: null }),
    };
    const service = serviceWithClient({ rpc: jest.fn() }, adminClient);

    await service.notifyPaymentRequired(orderId);

    expect(adminClient.rpc).toHaveBeenCalledWith(
      'notify_order_payment_required',
      { p_order_id: orderId },
    );
  });

  it('returns unread and read notifications for the caller JWT only', async () => {
    const rows = [
      notificationRow(),
      notificationRow({
        id: '13131313-1313-4131-8131-131313131313',
        read_status: 'read',
        read_at: '2026-08-18T01:00:00.000Z',
      }),
    ];
    const asUser = jest.fn().mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: rows, error: null }),
    });
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

    const result = await service.listMine(merchant);

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(result.unread).toHaveLength(1);
    expect(result.read).toHaveLength(1);
    expect(result.realtime).toEqual({
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${merchant.id}`,
      events: ['INSERT', 'UPDATE'],
    });
  });

  it('isolates merchant notifications by access token', async () => {
    const merchantClient = {
      rpc: jest.fn().mockResolvedValue({
        data: [notificationRow()],
        error: null,
      }),
    };
    const otherClient = {
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const asUser = jest.fn((token: string) =>
      token === merchant.accessToken ? merchantClient : otherClient,
    );
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

    const own = await service.listMine(merchant);
    const other = await service.listMine(otherMerchant);

    expect(own.unread).toHaveLength(1);
    expect(other.unread).toEqual([]);
    expect(other.read).toEqual([]);
  });

  it('loads admin notifications with the admin JWT', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          notificationRow({
            user_id: admin.id,
            type: 'shipping_confirmed',
            title: 'Merchant Order Waiting For Confirmation',
          }),
        ],
        error: null,
      }),
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

    const result = await service.listMine(admin);

    expect(asUser).toHaveBeenCalledWith(admin.accessToken);
    expect(result.unread[0].type).toBe('shipping_confirmed');
  });

  it('marks a single notification and all notifications read', async () => {
    const client = {
      rpc: jest
        .fn()
        .mockResolvedValueOnce({
          data: notificationRow({ read_status: 'read' }),
          error: null,
        })
        .mockResolvedValueOnce({ data: 3, error: null }),
    };
    const service = serviceWithClient(client);

    await service.markRead(merchant, notificationId);
    const all = await service.markAllRead(merchant);

    expect(client.rpc).toHaveBeenCalledWith('mark_notification_read', {
      p_id: notificationId,
    });
    expect(client.rpc).toHaveBeenCalledWith('mark_all_notifications_read');
    expect(all.updated).toBe(3);
  });

  it('blocks merchants from admin notification routes', () => {
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
