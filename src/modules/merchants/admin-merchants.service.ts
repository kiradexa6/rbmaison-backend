import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  AdminSearchApplicationsQueryDto,
  AdminSearchListingsQueryDto,
  AdminSearchMerchantsQueryDto,
} from './dto/merchant.dto';

@Injectable()
export class AdminMerchantsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async searchMerchants(
    user: AuthenticatedUser,
    query: AdminSearchMerchantsQueryDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_search_merchants',
      {
        p_store_id: query.storeId ?? undefined,
        p_query: query.q ?? undefined,
      },
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async searchApplications(
    user: AuthenticatedUser,
    query: AdminSearchApplicationsQueryDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_search_applications',
      {
        p_status: query.status ?? undefined,
        p_query: query.q ?? undefined,
      },
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async approve(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_approve_merchant_application',
      { p_id: id },
    );
    const rows = assertSupabase({ data, error }, 'Application not found') ?? [];
    const result = rows[0];
    if (!result) {
      throw new NotFoundException('Application not found');
    }
    return result;
  }

  async reject(user: AuthenticatedUser, id: string, reason?: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_reject_merchant_application',
      { p_id: id, p_reason: reason?.trim() || undefined },
    );
    const rows = assertSupabase({ data, error }, 'Application not found') ?? [];
    const result = rows[0];
    if (!result) {
      throw new NotFoundException('Application not found');
    }
    return result;
  }

  async getMerchant(user: AuthenticatedUser, merchantId: string) {
    const client = this.client(user);

    const { data: merchant, error: merchantError } = await client
      .from('merchants')
      .select(
        'id, user_id, store_id, store_name, business_email, phone, country, verification_status, status, wholesale_enabled, created_at',
      )
      .eq('id', merchantId)
      .maybeSingle();

    const profileRow = assertSupabase(
      { data: merchant, error: merchantError },
      'Merchant not found',
    );
    if (!profileRow) {
      throw new NotFoundException('Merchant not found');
    }

    const [
      { data: store, error: storeError },
      { data: owner, error: ownerError },
      { data: listings, error: listingsError },
      { data: orders, error: ordersError },
      { data: wallets, error: walletsError },
    ] = await Promise.all([
      client
        .from('stores')
        .select('id, store_name, description, logo, status, created_at')
        .eq('merchant_id', merchantId)
        .maybeSingle(),
      client
        .from('profiles')
        .select('full_name, email, phone, country')
        .eq('user_id', profileRow.user_id)
        .maybeSingle(),
      client.rpc('admin_search_listings', { p_merchant_id: merchantId }),
      client
        .from('orders')
        .select(
          'id, customer_id, store_id, status, total_amount, currency, created_at',
        )
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: false }),
      client
        .from('wallets')
        .select('id, currency, balance, updated_at')
        .eq('merchant_id', merchantId)
        .order('currency'),
    ]);

    assertSupabase({ data: store, error: storeError });
    assertSupabase({ data: owner, error: ownerError });
    const listingRows = assertSupabase({ data: listings, error: listingsError }) ?? [];
    const orderRows = assertSupabase({ data: orders, error: ordersError }) ?? [];
    const walletRows = assertSupabase({ data: wallets, error: walletsError }) ?? [];

    const walletIds = walletRows.map((wallet) => wallet.id);
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

    return {
      merchant_id: profileRow.id,
      store_id: profileRow.store_id,
      store_name: profileRow.store_name,
      owner: {
        name: owner?.full_name ?? null,
        email: owner?.email ?? profileRow.business_email,
        phone: owner?.phone ?? profileRow.phone,
        country: owner?.country ?? profileRow.country,
      },
      verification_status: profileRow.verification_status,
      account_status: profileRow.status,
      wholesale_enabled: profileRow.wholesale_enabled,
      store,
      listings: listingRows,
      orders: orderRows,
      wallets: walletRows,
      transactions,
    };
  }

  async searchListings(
    user: AuthenticatedUser,
    query: AdminSearchListingsQueryDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_search_listings',
      {
        p_store_id: query.storeId ?? undefined,
        p_merchant_id: query.merchantId ?? undefined,
        p_merchant_query: query.merchant ?? undefined,
        p_product_query: query.product ?? undefined,
        p_status: query.status ?? undefined,
      },
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async disableListing(user: AuthenticatedUser, listingId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_listing_status',
      { p_listing_id: listingId, p_status: 'inactive' },
    );
    return assertSupabase({ data, error }, 'Listing not found');
  }

  async removeListing(user: AuthenticatedUser, listingId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_listing_status',
      { p_listing_id: listingId, p_status: 'removed' },
    );
    return assertSupabase({ data, error }, 'Listing not found');
  }

  async setWholesaleAccess(
    user: AuthenticatedUser,
    merchantId: string,
    enabled: boolean,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_merchant_wholesale_access',
      { p_merchant_id: merchantId, p_enabled: enabled },
    );
    return assertSupabase({ data, error }, 'Merchant not found');
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
