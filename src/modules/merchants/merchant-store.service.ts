import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StorageService } from '../../infrastructure/supabase/storage.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import { UpdateMerchantStoreDto } from './dto/merchant.dto';

@Injectable()
export class MerchantStoreService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly storageService: StorageService,
  ) {}

  async getStore(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc(
      'merchant_store_profile',
    );
    const rows = assertSupabase({ data, error }) ?? [];
    const profile = rows[0];
    if (!profile) {
      throw new NotFoundException('Merchant store not found');
    }
    return profile;
  }

  async shopDetails(user: AuthenticatedUser) {
    const client = this.client(user);
    const [
      { data: details, error: detailsError },
      { data: products, error: productsError },
      { data: financials, error: financialsError },
    ] = await Promise.all([
      client.rpc('shop_details'),
      client.rpc('store_shop_products'),
      client.rpc('shop_financials'),
    ]);

    const rows = assertSupabase({ data: details, error: detailsError }) ?? [];
    const store = rows[0];
    if (!store) {
      throw new NotFoundException('Merchant store not found');
    }

    return {
      ...store,
      products: assertSupabase({ data: products, error: productsError }) ?? [],
      financials:
        assertSupabase({ data: financials, error: financialsError }) ?? [],
    };
  }

  async shopStatistics(user: AuthenticatedUser) {
    const client = this.client(user);
    const [
      { data: stats, error: statsError },
      { data: financials, error: financialsError },
    ] = await Promise.all([
      client.rpc('shop_statistics'),
      client.rpc('shop_financials'),
    ]);

    const rows = assertSupabase({ data: stats, error: statsError }) ?? [];
    const statistics = rows[0];
    if (!statistics) {
      throw new NotFoundException('Merchant store not found');
    }

    return {
      ...statistics,
      financials:
        assertSupabase({ data: financials, error: financialsError }) ?? [],
    };
  }

  async updateStore(user: AuthenticatedUser, dto: UpdateMerchantStoreDto) {
    const { data, error } = await this.client(user).rpc('update_merchant_store', {
      p_store_name: dto.storeName?.trim() || undefined,
      p_description: dto.description ?? undefined,
      p_logo: dto.logo?.trim() || undefined,
    });
    return assertSupabase({ data, error }, 'Merchant store not found');
  }

  async uploadLogo(
    user: AuthenticatedUser,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    const { data, error } = await this.client(user).rpc('merchant_store_profile');
    const rows = assertSupabase({ data, error }) ?? [];
    const store = rows[0] as { merchant_id?: string } | undefined;
    if (!store?.merchant_id) {
      throw new NotFoundException('Merchant store not found');
    }

    const uploaded = await this.storageService.uploadStoreLogo(
      user,
      store.merchant_id,
      file,
    );

    return this.updateStore(user, {
      logo: uploaded.publicUrl ?? uploaded.storagePath,
    });
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
