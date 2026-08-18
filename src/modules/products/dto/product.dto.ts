import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  ProductGender,
  ProductStatus,
  SupportedCurrency,
} from '../../../infrastructure/supabase/types/database.types';

export class SearchCatalogueQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(['women', 'men', 'unisex'] as const)
  gender?: ProductGender;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  availableOnly?: boolean;
}

export class CreateProductDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  brandId!: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsEnum(['women', 'men', 'unisex'] as const)
  gender?: ProductGender;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collection?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  price!: number;

  @IsOptional()
  @IsEnum(['USD', 'BTC', 'ETH', 'USDT'] as const)
  currency?: SupportedCurrency;

  @IsOptional()
  @IsEnum(['draft', 'active', 'inactive', 'archived'] as const)
  status?: ProductStatus;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(['women', 'men', 'unisex'] as const)
  gender?: ProductGender;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collection?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  price?: number;

  @IsOptional()
  @IsEnum(['USD', 'BTC', 'ETH', 'USDT'] as const)
  currency?: SupportedCurrency;

  @IsOptional()
  @IsEnum(['draft', 'active', 'inactive', 'archived'] as const)
  status?: ProductStatus;
}

export class CreateProductImageDto {
  @IsString()
  @MaxLength(500)
  storagePath!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  altText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateVariantDto {
  @IsString()
  @MaxLength(64)
  sku!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  priceOverride?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  priceOverride?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AdjustInventoryDto {
  @IsEnum(['stock_added', 'stock_removed', 'adjustment'] as const)
  type!: 'stock_added' | 'stock_removed' | 'adjustment';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;
}

export class CreateBrandDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['active', 'inactive'] as const)
  status?: 'active' | 'inactive';
}

export class CreateCategoryDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class CreateListingDto {
  @IsUUID()
  productId!: string;
}

export class PreviewListingDto {
  @IsUUID()
  productId!: string;
}
