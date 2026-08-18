import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { OrderStatus } from '../../../infrastructure/supabase/types/database.types';

export class CreateOrderItemDto {
  @IsOptional()
  @IsUUID()
  listingId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsUUID()
  variantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsUUID()
  merchantId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}

export class AdminSearchOrdersQueryDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customer?: string;

  @IsOptional()
  @IsEnum([
    'pending',
    'awaiting_payment',
    'confirmed',
    'paid',
    'processing',
    'shipping',
    'shipped',
    'delivered',
    'completed',
    'cancelled',
    'refunded',
  ] as const)
  status?: OrderStatus;
}

export class AdminSearchMerchantOrdersQueryDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  product?: string;
}
