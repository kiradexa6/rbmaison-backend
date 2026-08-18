import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  AdminSearchMerchantOrdersQueryDto,
  AdminSearchOrdersQueryDto,
} from './dto/order.dto';
import { lineAmount } from './order.math';

type MerchantOrderRow = {
  order_id: string;
  store_id: string;
  store_name: string;
  merchant_id: string;
  merchant_name: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_email: string;
  status: string;
  total_amount: string;
  currency: string;
  created_at: string;
  amount_paid: string;
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
export class AdminOrdersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async search(user: AuthenticatedUser, query: AdminSearchOrdersQueryDto) {
    const { data, error } = await this.client(user).rpc('admin_search_orders', {
      p_order_id: query.orderId ?? undefined,
      p_store_id: query.storeId ?? undefined,
      p_merchant_query: query.merchant ?? undefined,
      p_customer_query: query.customer ?? undefined,
      p_status: query.status ?? undefined,
    });
    return assertSupabase({ data, error }) ?? [];
  }

  async getOrder(user: AuthenticatedUser, orderId: string) {
    const client = this.client(user);
    const { data: headers, error } = await client.rpc('admin_search_orders', {
      p_order_id: orderId,
    });
    const rows = assertSupabase({ data: headers, error }) ?? [];
    const header = rows[0];
    if (!header) {
      throw new NotFoundException('Order not found');
    }

    const [{ data: items, error: itemsError }, payments] = await Promise.all([
      client
        .from('order_items')
        .select(
          'id, listing_id, product_id, variant_id, quantity, sales_price, wholesale_price, merchant_profit, created_at',
        )
        .eq('order_id', orderId),
      this.payments(user, orderId),
    ]);

    return {
      ...header,
      items: assertSupabase({ data: items, error: itemsError }) ?? [],
      payments,
    };
  }

  async confirmDelivery(user: AuthenticatedUser, orderId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_confirm_delivery',
      { p_order_id: orderId },
    );
    return assertSupabase({ data, error }, 'Order not found');
  }

  async searchMerchantOrders(
    user: AuthenticatedUser,
    query: AdminSearchMerchantOrdersQueryDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_merchant_orders',
      {
        p_order_id: query.orderId ?? undefined,
        p_store_id: query.storeId ?? undefined,
        p_merchant_id: query.merchantId ?? undefined,
        p_product_query: query.product ?? undefined,
      },
    );
    const rows = (assertSupabase({ data, error }) ?? []) as MerchantOrderRow[];
    return this.groupMerchantOrders(rows);
  }

  async getMerchantOrder(user: AuthenticatedUser, orderId: string) {
    const orders = await this.searchMerchantOrders(user, { orderId });
    const order = orders.find((item) => item.order_id === orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    const payments = await this.payments(user, orderId);
    return { ...order, payments };
  }

  async completeMerchantOrder(user: AuthenticatedUser, orderId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_complete_merchant_order',
      { p_order_id: orderId },
    );
    return assertSupabase({ data, error }, 'Order not found');
  }

  async cancel(user: AuthenticatedUser, orderId: string) {
    const { data, error } = await this.client(user).rpc('cancel_order', {
      p_order_id: orderId,
    });
    return assertSupabase({ data, error }, 'Order not found');
  }

  async payments(user: AuthenticatedUser, orderId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_order_payments',
      { p_order_id: orderId },
    );
    return assertSupabase({ data, error }) ?? [];
  }

  private groupMerchantOrders(rows: MerchantOrderRow[]) {
    const grouped = new Map<
      string,
      {
        order_id: string;
        store_id: string;
        store_name: string;
        merchant_id: string;
        merchant_name: string | null;
        status: string;
        total_amount: string;
        currency: string;
        created_at: string;
        amount_paid: string;
        customer: {
          id: string;
          name: string | null;
          email: string;
        };
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
          store_name: row.store_name,
          merchant_id: row.merchant_id,
          merchant_name: row.merchant_name,
          status: row.status,
          total_amount: row.total_amount,
          currency: row.currency,
          created_at: row.created_at,
          amount_paid: row.amount_paid,
          customer: {
            id: row.customer_id,
            name: row.customer_name,
            email: row.customer_email,
          },
          items: [],
        };
        grouped.set(row.order_id, order);
      }

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

    return [...grouped.values()].map((order) => ({
      ...order,
      wholesale_due: order.items.reduce(
        (sum, item) =>
          sum + lineAmount(Number(item.wholesale_price), item.quantity),
        0,
      ),
    }));
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
