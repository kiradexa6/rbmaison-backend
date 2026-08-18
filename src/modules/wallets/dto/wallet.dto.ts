import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  CryptoAsset,
  DepositRequestStatus,
  SupportedCurrency,
  WalletNetwork,
  WalletTransactionDirection,
  WithdrawalRequestStatus,
} from '../../../infrastructure/supabase/types/database.types';

export class AddWalletAddressDto {
  @IsEnum(['BTC', 'ETH', 'USDT'] as const)
  asset!: CryptoAsset;

  @IsEnum(['bitcoin', 'ethereum', 'erc20', 'trc20', 'bep20'] as const)
  network!: WalletNetwork;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  walletAddress!: string;
}

export class UpdateWalletAddressDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  walletAddress?: string;

  @IsOptional()
  @IsEnum(['bitcoin', 'ethereum', 'erc20', 'trc20', 'bep20'] as const)
  network?: WalletNetwork;
}

export class DepositAddressQueryDto {
  @IsEnum(['BTC', 'ETH', 'USDT'] as const)
  asset!: CryptoAsset;

  @IsEnum(['bitcoin', 'ethereum', 'erc20', 'trc20', 'bep20'] as const)
  network!: WalletNetwork;
}

export class CreateDepositRequestDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  amount!: number;

  @IsEnum(['BTC', 'ETH', 'USDT'] as const)
  asset!: CryptoAsset;

  @IsEnum(['bitcoin', 'ethereum', 'erc20', 'trc20', 'bep20'] as const)
  network!: WalletNetwork;
}

export class CreateWithdrawalRequestDto {
  @IsEnum(['BTC', 'ETH', 'USDT'] as const)
  asset!: CryptoAsset;

  @IsEnum(['bitcoin', 'ethereum', 'erc20', 'trc20', 'bep20'] as const)
  network!: WalletNetwork;

  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  amount!: number;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  destinationAddress!: string;
}

export class AdminDepositSearchQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string;

  @IsOptional()
  @IsEnum(['pending', 'approved', 'rejected'] as const)
  status?: DepositRequestStatus;
}

export class AdminWithdrawalSearchQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string;

  @IsOptional()
  @IsEnum(['pending', 'approved', 'rejected', 'completed'] as const)
  status?: WithdrawalRequestStatus;
}

export class AdjustMerchantWalletDto {
  @IsEnum(['USD', 'BTC', 'ETH', 'USDT'] as const)
  currency!: SupportedCurrency;

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
}
