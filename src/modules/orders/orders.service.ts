import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { NotificationService } from '../notifications/notifications.service';
import { assertSupabase } from '../products/supabase-error';
import { CreateOrderDto } from './dto/order.dto';
import { CUSTOMER_ORDER_HIDDEN_FIELDS, lineAmount } from './order.math';

type StoreOrderRow = {
  order_id: string;
  store_id: string;
  customer_id: string;
  customer_name: string | null;
  customer_email: string;
  status: string;
  total_amount: string;
  currency: string;
  created_at: string;
  item_id: string;
  listing_id: string | null;
  product_id: string;
  product_name: string;
  primary_image_url: string | null;
  quantity: number;
  sales_price: string;
  wholesale_price: string;
  unit_profit: string;
  merchant_profit: string;
  amount_required: string;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    @Optional() private readonly notificationService?: NotificationService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateOrderDto) {
    const items = dto.items.map((item) => {
      if (!item.listingId && !item.productId) {
        throw new BadRequestException(
          'Each item requires listingId or productId, variantId, and quantity',
        );
      }
      return {
        listing_id: item.listingId,
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantity,
      };
    });
    const { data, error } = await this.client(user).rpc('place_order', {
      p_merchant_id: dto.merchantId,
      p_items: items,
    });
    return assertSupabase({ data, error });
  }

  async myOrders(user: AuthenticatedUser) {
    const client = this.client(user);
    const { data: orders, error } = await client
      .from('orders')
      .select(
        'id, merchant_id, store_id, status, total_amount, currency, created_at',
      )
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false });
    const rows = assertSupabase({ data: orders, error }) ?? [];
    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const { data: items, error: itemsError } = await client
      .from('customer_order_items')
      .select(
        'id, order_id, product_id, listing_id, variant_id, quantity, sales_price, created_at',
      )
      .in('order_id', ids);
    const itemRows = assertSupabase({ data: items, error: itemsError }) ?? [];

    return rows.map((order) =>
      this.stripCustomer({
        ...order,
        items: itemRows.filter((item) => item.order_id === order.id),
      }),
    );
  }

  async getMyOrder(user: AuthenticatedUser, orderId: string) {
    const orders = await this.myOrders(user);
    const order = orders.find((item) => item.id === orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async cancelMyOrder(user: AuthenticatedUser, orderId: string) {
    const { data, error } = await this.client(user).rpc('cancel_order', {
      p_order_id: orderId,
    });
    return assertSupabase({ data, error }, 'Order not found');
  }

  async storeOrders(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc(
      'merchant_store_orders',
    );
    const rows = (assertSupabase({ data, error }) ?? []) as StoreOrderRow[];
    return this.groupStoreOrders(rows);
  }

  async getStoreOrder(user: AuthenticatedUser, orderId: string) {
    const orders = await this.storeOrders(user);
    const order = orders.find((item) => item.order_id === orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async confirmStoreOrder(user: AuthenticatedUser, orderId: string) {
    const { data, error } = await this.client(user).rpc(
      'confirm_merchant_order',
      { p_order_id: orderId },
    );
    if (
      error &&
      /insufficient balance/i.test(error.message) &&
      /top up/i.test(error.message)
    ) {
      await this.notificationService?.notifyPaymentRequired(orderId);
    }
    return assertSupabase({ data, error }, 'Order not found');
  }

  async goForShipping(user: AuthenticatedUser, orderId: string) {
    const { data, error } = await this.client(user).rpc(
      'merchant_send_for_shipping',
      { p_order_id: orderId },
    );
    return assertSupabase({ data, error }, 'Order not found');
  }

  private groupStoreOrders(rows: StoreOrderRow[]) {
    const grouped = new Map<
      string,
      {
        order_id: string;
        store_id: string;
        status: string;
        total_amount: string;
        currency: string;
        created_at: string;
        customer: {
          id: string;
          name: string | null;
          email: string;
        };
        wholesale_due: number;
        items: Array<{
          item_id: string;
          listing_id: string | null;
          product_id: string;
          product_name: string;
          primary_image_url: string | null;
          quantity: number;
          sales_price: string;
          wholesale_price: string;
          profit: string;
          amount_required: string;
        }>;
      }
    >();

    for (const row of rows) {
      let order = grouped.get(row.order_id);
      if (!order) {
        order = {
          order_id: row.order_id,
          store_id: row.store_id,
          status: row.status,
          total_amount: row.total_amount,
          currency: row.currency,
          created_at: row.created_at,
          customer: {
            id: row.customer_id,
            name: row.customer_name,
            email: row.customer_email,
          },
          wholesale_due: 0,
          items: [],
        };
        grouped.set(row.order_id, order);
      }

      const amountRequired = lineAmount(
        Number(row.wholesale_price),
        row.quantity,
      );
      order.wholesale_due = lineAmount(order.wholesale_due + amountRequired, 1);
      order.items.push({
        item_id: row.item_id,
        listing_id: row.listing_id,
        product_id: row.product_id,
        product_name: row.product_name,
        primary_image_url: row.primary_image_url,
        quantity: row.quantity,
        sales_price: row.sales_price,
        wholesale_price: row.wholesale_price,
        profit: row.unit_profit,
        amount_required: row.amount_required,
      });
    }

    return [...grouped.values()];
  }

  private stripCustomer<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripCustomer(item)) as T;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([key]) =>
          !CUSTOMER_ORDER_HIDDEN_FIELDS.includes(
            key as (typeof CUSTOMER_ORDER_HIDDEN_FIELDS)[number],
          ),
      );
      return Object.fromEntries(
        entries.map(([key, nested]) => [key, this.stripCustomer(nested)]),
      ) as T;
    }
    return value;
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
