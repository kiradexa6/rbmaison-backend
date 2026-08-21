import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  CreateListingDto,
  PreviewListingDto,
  SearchCatalogueQueryDto,
} from './dto/product.dto';
import { listingAction, wholesalePrice } from './product.math';
import { assertSupabase } from './supabase-error';

@Injectable()
export class MerchantListingsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async wholesaleCatalogue(
    user: AuthenticatedUser,
    query: SearchCatalogueQueryDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'merchant_wholesale_catalog',
      {
        p_query: query.q ?? undefined,
        p_brand_id: query.brandId ?? undefined,
        p_category_id: query.categoryId ?? undefined,
        p_gender: query.gender ?? undefined,
        p_price_min: query.priceMin ?? undefined,
        p_price_max: query.priceMax ?? undefined,
        p_available_only: query.availableOnly ?? false,
      },
    );

    const rows = assertSupabase({ data, error }) ?? [];
    return rows.map((row) => ({
      ...row,
      action: listingAction(row.listed),
    }));
  }

  async previewListing(user: AuthenticatedUser, dto: PreviewListingDto) {
    const { data, error } = await this.client(user).rpc(
      'preview_merchant_listing',
      { p_product_id: dto.productId },
    );
    const rows = assertSupabase({ data, error }) ?? [];
    const preview = rows[0];
    if (!preview) {
      throw new NotFoundException('Product is not available for listing');
    }

    return {
      ...preview,
      wholesale_price: Number(preview.wholesale_price).toFixed(2),
      expected_wholesale_price: wholesalePrice(
        Number(preview.sales_price),
      ).toFixed(2),
      action: listingAction(preview.listed),
    };
  }

  async createListing(user: AuthenticatedUser, dto: CreateListingDto) {
    const { data, error } = await this.client(user).rpc(
      'create_merchant_listing',
      { p_product_id: dto.productId },
    );
    const listing = assertSupabase({ data, error });
    return {
      ...listing,
      action: listingAction(true),
    };
  }

  async myProducts(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc(
      'merchant_listed_products',
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async getListedProduct(user: AuthenticatedUser, listingId: string) {
    const { data, error } = await this.client(user).rpc(
      'merchant_listing_detail',
      { p_listing_id: listingId },
    );
    const rows = assertSupabase({ data, error }) ?? [];
    const listing = rows[0];
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  async removeListing(user: AuthenticatedUser, listingId: string) {
    const { data, error } = await this.client(user).rpc(
      'remove_merchant_listing',
      { p_listing_id: listingId },
    );
    return assertSupabase({ data, error }, 'Listing not found');
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
