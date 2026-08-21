import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  AdjustStoreBalanceDto,
  AdjustStoreCreditDto,
  AdjustStoreViewersDto,
  AdminSearchStoresQueryDto,
  SetStoreStatusDto,
} from './dto/merchant.dto';

@Injectable()
export class AdminStoresService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async search(user: AuthenticatedUser, query: AdminSearchStoresQueryDto) {
    const { data, error } = await this.client(user).rpc('admin_search_stores', {
      p_store_id: query.storeId ?? undefined,
      p_merchant_id: query.merchantId ?? undefined,
      p_store_name: query.storeName ?? query.q ?? undefined,
      p_email: query.email ?? undefined,
    });
    return assertSupabase({ data, error }) ?? [];
  }

  async getStore(user: AuthenticatedUser, storeId: string) {
    const client = this.client(user);
    const [
      { data: details, error: detailsError },
      { data: stats, error: statsError },
      { data: financials, error: financialsError },
      { data: products, error: productsError },
      { data: orders, error: ordersError },
    ] = await Promise.all([
      client.rpc('shop_details', { p_store_id: storeId }),
      client.rpc('shop_statistics', { p_store_id: storeId }),
      client.rpc('shop_financials', { p_store_id: storeId }),
      client.rpc('store_shop_products', { p_store_id: storeId }),
      client.rpc('store_shop_orders', { p_store_id: storeId }),
    ]);

    const detailRows =
      assertSupabase({ data: details, error: detailsError }) ?? [];
    const store = detailRows[0];
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const statisticRows =
      assertSupabase({ data: stats, error: statsError }) ?? [];
    const financialRows =
      assertSupabase({ data: financials, error: financialsError }) ?? [];

    const walletIds = financialRows.map((row) => row.wallet_id).filter(Boolean);
    let transactions: unknown[] = [];
    if (walletIds.length > 0) {
      const { data: txRows, error: txError } = await client
        .from('wallet_transactions')
        .select(
          'id, wallet_id, type, amount, currency, direction, status, reference_type, reference_id, description, created_at',
        )
        .in('wallet_id', walletIds)
        .order('created_at', { ascending: false });
      transactions = assertSupabase({ data: txRows, error: txError }) ?? [];
    }

    const { data: creditRows, error: creditError } = await client
      .from('merchant_credit_scores')
      .select('id, merchant_id, score, reason, updated_by, created_at')
      .eq('merchant_id', store.merchant_id)
      .order('created_at', { ascending: false });

    return {
      merchant: {
        merchant_id: store.merchant_id,
        owner_user_id: store.owner_user_id,
        owner_name: store.owner_name,
        owner_email: store.owner_email,
        owner_phone: store.owner_phone,
        country: store.country,
        verification_status: store.verification_status,
        merchant_status: store.merchant_status,
        wholesale_enabled: store.wholesale_enabled,
      },
      store,
      statistics: statisticRows[0] ?? null,
      financials: financialRows,
      products: assertSupabase({ data: products, error: productsError }) ?? [],
      orders: assertSupabase({ data: orders, error: ordersError }) ?? [],
      wallets: financialRows.map((row) => ({
        id: row.wallet_id,
        currency: row.currency,
        balance: row.wallet_balance,
      })),
      transactions,
      credit_scores:
        assertSupabase({ data: creditRows, error: creditError }) ?? [],
    };
  }

  async products(user: AuthenticatedUser, storeId: string) {
    const { data, error } = await this.client(user).rpc('store_shop_products', {
      p_store_id: storeId,
    });
    return assertSupabase({ data, error }, 'Store not found') ?? [];
  }

  async orders(user: AuthenticatedUser, storeId: string) {
    const { data, error } = await this.client(user).rpc('store_shop_orders', {
      p_store_id: storeId,
    });
    return assertSupabase({ data, error }, 'Store not found') ?? [];
  }

  async adjustBalance(
    user: AuthenticatedUser,
    storeId: string,
    dto: AdjustStoreBalanceDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_adjust_store_wallet',
      {
        p_store_id: storeId,
        p_amount: dto.amount,
        p_direction: dto.direction,
        p_reason: dto.reason.trim(),
        p_currency: dto.currency ?? 'USD',
      },
    );
    return assertSupabase({ data, error }, 'Store not found');
  }

  async adjustCredit(
    user: AuthenticatedUser,
    storeId: string,
    dto: AdjustStoreCreditDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_adjust_store_credit',
      {
        p_store_id: storeId,
        p_score: dto.score,
        p_reason: dto.reason.trim(),
      },
    );
    return assertSupabase({ data, error }, 'Store not found');
  }

  async setStatus(
    user: AuthenticatedUser,
    storeId: string,
    dto: SetStoreStatusDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_store_status',
      {
        p_store_id: storeId,
        p_status: dto.status,
        p_reason: dto.reason?.trim() || undefined,
      },
    );
    return assertSupabase({ data, error }, 'Store not found');
  }

  async setWholesaleAccess(
    user: AuthenticatedUser,
    storeId: string,
    enabled: boolean,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_store_wholesale_access',
      { p_store_id: storeId, p_enabled: enabled },
    );
    return assertSupabase({ data, error }, 'Store not found');
  }

  async adjustViewers(
    user: AuthenticatedUser,
    storeId: string,
    dto: AdjustStoreViewersDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_adjust_store_viewers',
      {
        p_store_id: storeId,
        p_viewer_count: dto.viewerCount,
        p_reason: dto.reason.trim(),
      },
    );
    return assertSupabase({ data, error }, 'Store not found');
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
