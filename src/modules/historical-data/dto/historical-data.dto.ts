import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type {
  HistoricalActivityLevel,
  HistoricalCategory,
  HistoricalRangePreset,
} from '../../../infrastructure/supabase/types/database.types';

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
  @IsUUID()
  userId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(HISTORICAL_CATEGORIES, { each: true })
  categories!: HistoricalCategory[];

  @IsEnum(HISTORICAL_ACTIVITY_LEVELS)
  activityLevel!: HistoricalActivityLevel;

  @IsEnum(HISTORICAL_RANGE_PRESETS)
  rangePreset!: HistoricalRangePreset;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class GenerateHistoricalDataDto extends PreviewHistoricalDataDto {
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  confirm!: boolean;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}
