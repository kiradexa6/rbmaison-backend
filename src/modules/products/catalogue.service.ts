import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { STORAGE_BUCKETS } from '../../infrastructure/supabase/supabase.constants';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { SearchCatalogueQueryDto } from './dto/product.dto';
import { PUBLIC_PRODUCT_HIDDEN_FIELDS } from './product.math';
import { assertSupabase } from './supabase-error';

export type PublicProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  gender: string;
  collection: string | null;
  price: number;
  currency: string;
  brand: { id: string; name: string; slug: string; logo: string | null };
  category: {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
  };
  images: Array<{
    id: string;
    imageUrl: string | null;
    position: number;
    isPrimary: boolean;
    altText: string | null;
  }>;
  variants: Array<{
    id: string;
    sku: string;
    size: string | null;
    color: string | null;
    price: number;
    inStock: boolean;
  }>;
  availability: boolean;
};

@Injectable()
export class CatalogueService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async search(query: SearchCatalogueQueryDto) {
    const client = this.anon();
    const { data, error } = await client.rpc('search_catalogue', {
      p_query: query.q ?? undefined,
      p_brand_id: query.brandId ?? undefined,
      p_category_id: query.categoryId ?? undefined,
      p_gender: query.gender ?? undefined,
      p_price_min: query.priceMin ?? undefined,
      p_price_max: query.priceMax ?? undefined,
      p_available_only: query.availableOnly ?? false,
    });

    const rows = assertSupabase({ data, error });
    return (rows ?? []).map((row) => this.stripHidden(row));
  }

  async getByIdOrSlug(idOrSlug: string): Promise<PublicProduct> {
    const client = this.anon();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );

    let productQuery = client
      .from('products')
      .select(
        'id, name, slug, description, gender, collection, price, currency, brand_id, category_id',
      );

    productQuery = isUuid
      ? productQuery.eq('id', idOrSlug)
      : productQuery.eq('slug', idOrSlug);

    const { data: product, error } = await productQuery.maybeSingle();
    const row = assertSupabase({ data: product, error }, 'Product not found');
    if (!row) {
      throw new NotFoundException('Product not found');
    }

    const productId = row.id;
    const [
      { data: images },
      { data: variants },
      { data: availability },
      { data: brandRow },
      { data: categoryRow },
    ] = await Promise.all([
      client
        .from('product_images')
        .select('id, image_url, storage_path, position, is_primary, alt_text')
        .eq('product_id', productId)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true }),
      client
        .from('product_variants')
        .select('id, sku, size, color, price_override, is_active')
        .eq('product_id', productId)
        .eq('is_active', true),
      client
        .from('catalogue_availability')
        .select('variant_id, in_stock')
        .eq('product_id', productId),
      client
        .from('brands')
        .select('id, name, slug, logo')
        .eq('id', row.brand_id)
        .maybeSingle(),
      client
        .from('product_categories')
        .select('id, name, slug, parent_id')
        .eq('id', row.category_id)
        .maybeSingle(),
    ]);

    const stockByVariant = new Map(
      (availability ?? []).map((item) => [item.variant_id, item.in_stock]),
    );
    const price = Number(row.price);
    const brand = this.asRecord(brandRow);
    const category = this.asRecord(categoryRow);

    const publicProduct: PublicProduct = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      gender: row.gender,
      collection: row.collection,
      price,
      currency: row.currency,
      brand: {
        id: String(brand.id ?? row.brand_id),
        name: String(brand.name ?? ''),
        slug: String(brand.slug ?? ''),
        logo: (brand.logo as string | null) ?? null,
      },
      category: {
        id: String(category.id ?? row.category_id),
        name: String(category.name ?? ''),
        slug: String(category.slug ?? ''),
        parentId: (category.parent_id as string | null) ?? null,
      },
      images: (images ?? []).map((image) => ({
        id: image.id,
        imageUrl: this.publicImageUrl(image.image_url, image.storage_path),
        position: image.position,
        isPrimary: image.is_primary,
        altText: image.alt_text,
      })),
      variants: (variants ?? []).map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        price: variant.price_override ? Number(variant.price_override) : price,
        inStock: stockByVariant.get(variant.id) === true,
      })),
      availability: [...stockByVariant.values()].some(Boolean),
    };

    return this.stripHidden(publicProduct);
  }

  async listBrands() {
    const { data, error } = await this.anon()
      .from('brands')
      .select('id, name, slug, logo, description')
      .eq('status', 'active')
      .order('name');
    return assertSupabase({ data, error }) ?? [];
  }

  async listCategories() {
    const { data, error } = await this.anon()
      .from('product_categories')
      .select('id, name, slug, description, parent_id')
      .order('name');
    return assertSupabase({ data, error }) ?? [];
  }

  stripHidden<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripHidden(item)) as T;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([key]) =>
          !PUBLIC_PRODUCT_HIDDEN_FIELDS.includes(
            key as (typeof PUBLIC_PRODUCT_HIDDEN_FIELDS)[number],
          ),
      );
      return Object.fromEntries(
        entries.map(([key, nested]) => [key, this.stripHidden(nested)]),
      ) as T;
    }
    return value;
  }

  private anon() {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.getAnonClient();
  }

  private publicImageUrl(
    imageUrl: string | null,
    storagePath: string,
  ): string | null {
    if (imageUrl) {
      return imageUrl;
    }
    const url = this.supabaseService.getPublicUrl();
    if (!url || !storagePath) {
      return storagePath || null;
    }
    if (storagePath.startsWith('http')) {
      return storagePath;
    }
    return `${url}/storage/v1/object/public/${STORAGE_BUCKETS.PRODUCT_IMAGES}/${storagePath}`;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (Array.isArray(value)) {
      return (value[0] as Record<string, unknown> | undefined) ?? {};
    }
    return (value as Record<string, unknown> | null) ?? {};
  }
}
