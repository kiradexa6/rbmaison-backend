import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { STORAGE_BUCKETS } from '../../infrastructure/supabase/supabase.constants';
import {
  SupabaseService,
  TypedSupabaseClient,
} from '../../infrastructure/supabase/supabase.service';
import { Database } from '../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  AdjustInventoryDto,
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateProductImageDto,
  CreateVariantDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';
import { slugify } from './product.math';
import { mapSupabaseError, assertSupabase } from './supabase-error';

@Injectable()
export class AdminProductsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createProduct(user: AuthenticatedUser, dto: CreateProductDto) {
    const client = this.asUser(user);
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
    const { data, error } = await client
      .from('products')
      .insert({
        name: dto.name.trim(),
        slug,
        description: dto.description ?? null,
        brand_id: dto.brandId,
        category_id: dto.categoryId,
        gender: dto.gender ?? 'unisex',
        collection: dto.collection ?? null,
        price: dto.price.toFixed(2),
        currency: dto.currency ?? 'USD',
        status: dto.status ?? 'draft',
        published: false,
      })
      .select()
      .single();
    return assertSupabase({ data, error });
  }

  async updateProduct(
    user: AuthenticatedUser,
    productId: string,
    dto: UpdateProductDto,
  ) {
    const client = this.asUser(user);
    const patch: Database['public']['Tables']['products']['Update'] = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.slug !== undefined) patch.slug = slugify(dto.slug);
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.brandId !== undefined) patch.brand_id = dto.brandId;
    if (dto.categoryId !== undefined) patch.category_id = dto.categoryId;
    if (dto.gender !== undefined) patch.gender = dto.gender;
    if (dto.collection !== undefined) patch.collection = dto.collection;
    if (dto.price !== undefined) patch.price = dto.price.toFixed(2);
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.status !== undefined) patch.status = dto.status;

    const { data, error } = await client
      .from('products')
      .update(patch)
      .eq('id', productId)
      .select()
      .maybeSingle();
    const row = assertSupabase({ data, error }, 'Product not found');
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    return row;
  }

  async publish(user: AuthenticatedUser, productId: string) {
    return this.setPublication(user, productId, true);
  }

  async unpublish(user: AuthenticatedUser, productId: string) {
    return this.setPublication(user, productId, false);
  }

  async archive(user: AuthenticatedUser, productId: string) {
    const { data, error } = await this.asUser(user).rpc(
      'admin_archive_product',
      {
        p_product_id: productId,
      },
    );
    return assertSupabase({ data, error }, 'Product not found');
  }

  async listProducts(user: AuthenticatedUser) {
    const { data, error } = await this.asUser(user)
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });
    return assertSupabase({ data, error }) ?? [];
  }

  async addImage(
    user: AuthenticatedUser,
    productId: string,
    dto: CreateProductImageDto,
  ) {
    const { data, error } = await this.asUser(user)
      .from('product_images')
      .insert({
        product_id: productId,
        storage_path: dto.storagePath,
        image_url: dto.imageUrl ?? null,
        alt_text: dto.altText ?? null,
        position: dto.position ?? 0,
        sort_order: dto.position ?? 0,
        is_primary: dto.isPrimary ?? false,
      })
      .select()
      .single();
    return assertSupabase({ data, error });
  }

  async uploadImage(
    user: AuthenticatedUser,
    productId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    options: { altText?: string; isPrimary?: boolean },
  ) {
    const client = this.asUser(user);
    const extension = file.originalname.split('.').pop() ?? 'bin';
    const path = `${productId}/${Date.now()}-${slugify(file.originalname.replace(/\.[^.]+$/, '')) || 'image'}.${extension}`;
    const { error: uploadError } = await client.storage
      .from(STORAGE_BUCKETS.PRODUCT_IMAGES)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (uploadError) {
      throw mapSupabaseError(uploadError, 'Image upload failed');
    }
    const publicUrl = this.supabaseService.getPublicUrl()
      ? `${this.supabaseService.getPublicUrl()}/storage/v1/object/public/${STORAGE_BUCKETS.PRODUCT_IMAGES}/${path}`
      : path;
    return this.addImage(user, productId, {
      storagePath: path,
      imageUrl: publicUrl,
      altText: options.altText,
      isPrimary: options.isPrimary,
    });
  }

  async setPrimaryImage(
    user: AuthenticatedUser,
    productId: string,
    imageId: string,
  ) {
    const { data, error } = await this.asUser(user)
      .from('product_images')
      .update({ is_primary: true })
      .eq('id', imageId)
      .eq('product_id', productId)
      .select()
      .maybeSingle();
    const row = assertSupabase({ data, error }, 'Image not found');
    if (!row) {
      throw new NotFoundException('Image not found');
    }
    return row;
  }

  async deleteImage(
    user: AuthenticatedUser,
    productId: string,
    imageId: string,
  ) {
    const { data, error } = await this.asUser(user)
      .from('product_images')
      .delete()
      .eq('id', imageId)
      .eq('product_id', productId)
      .select()
      .maybeSingle();
    const row = assertSupabase({ data, error }, 'Image not found');
    if (!row) {
      throw new NotFoundException('Image not found');
    }
    return row;
  }

  async addVariant(
    user: AuthenticatedUser,
    productId: string,
    dto: CreateVariantDto,
  ) {
    const { data, error } = await this.asUser(user)
      .from('product_variants')
      .insert({
        product_id: productId,
        sku: dto.sku.trim(),
        size: dto.size ?? null,
        color: dto.color ?? null,
        price_override: dto.priceOverride?.toFixed(2) ?? null,
        is_active: dto.isActive ?? true,
      })
      .select()
      .single();
    return assertSupabase({ data, error });
  }

  async updateVariant(
    user: AuthenticatedUser,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    const patch: Database['public']['Tables']['product_variants']['Update'] =
      {};
    if (dto.sku !== undefined) patch.sku = dto.sku.trim();
    if (dto.size !== undefined) patch.size = dto.size;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.priceOverride !== undefined) {
      patch.price_override = dto.priceOverride.toFixed(2);
    }
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;

    const { data, error } = await this.asUser(user)
      .from('product_variants')
      .update(patch)
      .eq('id', variantId)
      .select()
      .maybeSingle();
    const row = assertSupabase({ data, error }, 'Variant not found');
    if (!row) {
      throw new NotFoundException('Variant not found');
    }
    return row;
  }

  async adjustInventory(
    user: AuthenticatedUser,
    variantId: string,
    dto: AdjustInventoryDto,
  ) {
    const { data, error } = await this.asUser(user).rpc(
      'admin_adjust_inventory',
      {
        p_variant_id: variantId,
        p_type: dto.type,
        p_quantity: dto.quantity,
        p_reference: dto.reference ?? undefined,
      },
    );
    return assertSupabase({ data, error });
  }

  async listInventoryTransactions(user: AuthenticatedUser, variantId?: string) {
    let query = this.asUser(user)
      .from('inventory_transactions')
      .select('*')
      .order('created_at', { ascending: false });
    if (variantId) {
      query = query.eq('variant_id', variantId);
    }
    const { data, error } = await query;
    return assertSupabase({ data, error }) ?? [];
  }

  async createBrand(user: AuthenticatedUser, dto: CreateBrandDto) {
    const { data, error } = await this.asUser(user)
      .from('brands')
      .insert({
        name: dto.name.trim(),
        slug: dto.slug ? slugify(dto.slug) : slugify(dto.name),
        logo: dto.logo ?? null,
        description: dto.description ?? null,
        status: 'active',
      })
      .select()
      .single();
    return assertSupabase({ data, error });
  }

  async updateBrand(
    user: AuthenticatedUser,
    brandId: string,
    dto: UpdateBrandDto,
  ) {
    const patch: Database['public']['Tables']['brands']['Update'] = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.slug !== undefined) patch.slug = slugify(dto.slug);
    if (dto.logo !== undefined) patch.logo = dto.logo;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.status !== undefined) patch.status = dto.status;
    const { data, error } = await this.asUser(user)
      .from('brands')
      .update(patch)
      .eq('id', brandId)
      .select()
      .maybeSingle();
    const row = assertSupabase({ data, error }, 'Brand not found');
    if (!row) {
      throw new NotFoundException('Brand not found');
    }
    return row;
  }

  async createCategory(user: AuthenticatedUser, dto: CreateCategoryDto) {
    const { data, error } = await this.asUser(user)
      .from('product_categories')
      .insert({
        name: dto.name.trim(),
        slug: dto.slug ? slugify(dto.slug) : slugify(dto.name),
        description: dto.description ?? null,
        parent_id: dto.parentId ?? null,
      })
      .select()
      .single();
    return assertSupabase({ data, error });
  }

  async updateCategory(
    user: AuthenticatedUser,
    categoryId: string,
    dto: UpdateCategoryDto,
  ) {
    const patch: Database['public']['Tables']['product_categories']['Update'] =
      {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.slug !== undefined) patch.slug = slugify(dto.slug);
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.parentId !== undefined) patch.parent_id = dto.parentId;
    const { data, error } = await this.asUser(user)
      .from('product_categories')
      .update(patch)
      .eq('id', categoryId)
      .select()
      .maybeSingle();
    const row = assertSupabase({ data, error }, 'Category not found');
    if (!row) {
      throw new NotFoundException('Category not found');
    }
    return row;
  }

  private async setPublication(
    user: AuthenticatedUser,
    productId: string,
    published: boolean,
  ) {
    const { data, error } = await this.asUser(user).rpc(
      'admin_set_product_publication',
      {
        p_product_id: productId,
        p_published: published,
      },
    );
    return assertSupabase({ data, error }, 'Product not found');
  }

  private asUser(user: AuthenticatedUser): TypedSupabaseClient {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
