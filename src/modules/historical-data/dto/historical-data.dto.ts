import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  HistoricalActivityLevel,
  HistoricalCategory,
  HistoricalRangePreset,
} from '../../../infrastructure/supabase/types/database.types';
import { HISTORICAL_HISTORY_TYPES } from '../historical-records.mapper';

export const HISTORICAL_CATEGORIES = [
  'wallet',
  'deposits',
  'withdrawals',
  'orders',
  'viewers',
] as const satisfies readonly HistoricalCategory[];

export const HISTORICAL_RANGE_PRESETS = [
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'last_180_days',
  'custom',
] as const satisfies readonly HistoricalRangePreset[];

export const HISTORICAL_ACTIVITY_LEVELS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly HistoricalActivityLevel[];

export class PreviewHistoricalDataDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(HISTORICAL_CATEGORIES, { each: true })
  categories?: HistoricalCategory[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(HISTORICAL_HISTORY_TYPES, { each: true })
  historyTypes?: string[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsEnum(HISTORICAL_ACTIVITY_LEVELS)
  activityLevel?: HistoricalActivityLevel;

  /** Control Center volume selector — mapped to activityLevel. */
  @IsOptional()
  @IsEnum(HISTORICAL_ACTIVITY_LEVELS)
  volume?: HistoricalActivityLevel;

  @IsOptional()
  @IsEnum(HISTORICAL_RANGE_PRESETS)
  rangePreset?: HistoricalRangePreset;

  /** Accepted from Control Center, then ignored. Backend always uses 6 months. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class GenerateHistoricalDataDto extends PreviewHistoricalDataDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === false || value === 'false') {
      return false;
    }
    if (value === true || value === 'true' || value === undefined || value === null) {
      return true;
    }
    return value;
  })
  @IsBoolean()
  confirm?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey?: string;
}
