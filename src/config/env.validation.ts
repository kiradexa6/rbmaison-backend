import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import {
  assertProductionSupabaseTarget,
  isLocalSupabaseUrl,
} from '../infrastructure/supabase/supabase-project.util';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsString()
  @IsOptional()
  APP_NAME: string = 'RBMaison';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api/v1';

  @Transform(({ value }: { value: unknown }) => {
    if (value === 'false' || value === false) {
      return false;
    }
    if (value === 'true' || value === true) {
      return true;
    }
    return value;
  })
  @IsBoolean()
  @IsOptional()
  CORS_ENABLED: boolean = true;

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = '*';

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsOptional()
  SUPABASE_URL?: string;

  @IsString()
  @IsOptional()
  SUPABASE_ANON_KEY?: string;

  @IsString()
  @IsOptional()
  SUPABASE_SERVICE_ROLE_KEY?: string;

  @IsString()
  @IsOptional()
  SUPABASE_JWT_SECRET?: string;

  /** Hosted Supabase project ref — production guardrail against wrong database. */
  @IsString()
  @IsOptional()
  SUPABASE_PROJECT_REF?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(180)
  @IsOptional()
  HISTORICAL_MAX_DAYS: number = 180;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(40)
  @IsOptional()
  HISTORICAL_MAX_DEPOSITS: number = 40;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20)
  @IsOptional()
  HISTORICAL_MAX_WITHDRAWALS: number = 20;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(60)
  @IsOptional()
  HISTORICAL_MAX_ORDERS: number = 60;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  @IsOptional()
  HISTORICAL_MAX_WALLET_TRANSACTIONS: number = 200;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(400)
  @IsOptional()
  HISTORICAL_MAX_TOTAL_ROWS: number = 400;
}

const TRIMMED_ENV_KEYS = [
  'NODE_ENV',
  'APP_NAME',
  'API_PREFIX',
  'CORS_ORIGIN',
  'LOG_LEVEL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_PROJECT_REF',
] as const;

export function readEnvString(
  source: NodeJS.ProcessEnv | Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...config };
  for (const key of TRIMMED_ENV_KEYS) {
    if (typeof config[key] === 'string') {
      normalized[key] = readEnvString(config, key);
    }
  }
  return normalized;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(
    EnvironmentVariables,
    normalizeEnv(config),
    {
      enableImplicitConversion: false,
    },
  );

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  if (validatedConfig.NODE_ENV === Environment.Production) {
    const required = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_JWT_SECRET',
    ] as const;

    const missing = required.filter((key) => !validatedConfig[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required production environment variables: ${missing.join(', ')}`,
      );
    }

    const origin = validatedConfig.CORS_ORIGIN?.trim() ?? '';
    if (!origin || origin === '*') {
      throw new Error(
        'CORS_ORIGIN must be an explicit production origin (wildcard * is not allowed)',
      );
    }

    if (isLocalSupabaseUrl(validatedConfig.SUPABASE_URL)) {
      throw new Error(
        'Production cannot use a local Supabase URL. Set SUPABASE_URL to the hosted RB Maison project.',
      );
    }

    assertProductionSupabaseTarget(
      validatedConfig.SUPABASE_URL,
      validatedConfig.SUPABASE_PROJECT_REF,
    );
  }

  return validatedConfig;
}
