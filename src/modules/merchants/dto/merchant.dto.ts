import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  ListingStatus,
  MerchantApplicationStatus,
  StoreStatus,
  SupportedCurrency,
  WalletTransactionDirection,
} from '../../../infrastructure/supabase/types/database.types';

export class AdminSearchMerchantsQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class AdminSearchListingsQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  product?: string;

  @IsOptional()
  @IsEnum(['pending', 'active', 'suspended', 'inactive', 'removed'] as const)
  status?: ListingStatus;
}

export class SetWholesaleAccessDto {
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  @IsBoolean()
  enabled!: boolean;
}

export class AdminSearchUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** Control Center search box — alias of `q`. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class SubmitMerchantApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  storeName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  businessDescription?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(56)
  country?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  documents?: string[];
}

export class AdminSearchApplicationsQueryDto {
  @IsOptional()
  @IsEnum(['pending', 'approved', 'rejected', 'suspended'] as const)
  status?: MerchantApplicationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class RejectApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

export class AdminSearchStoresQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  storeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class AdjustStoreBalanceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  amount!: number;

  @IsEnum(['credit', 'debit'] as const)
  direction!: WalletTransactionDirection;

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;

  @IsOptional()
  @IsEnum(['USD', 'BTC', 'ETH', 'USDT'] as const)
  currency?: SupportedCurrency;
}

export class AdjustStoreCreditDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;
}

export class SetStoreStatusDto {
  @IsEnum(['active', 'suspended'] as const)
  status!: Extract<StoreStatus, 'active' | 'suspended'>;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

export class AdjustStoreViewersDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000)
  viewerCount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;
}

export class AdminActivityLogsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetType?: string;
}
