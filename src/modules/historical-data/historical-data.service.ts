import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import type {
  HistoricalActivityLevel,
  HistoricalCategory,
  Database,
} from '../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  GenerateHistoricalDataDto,
  PreviewHistoricalDataDto,
} from './dto/historical-data.dto';
import {
  availableHistoryTypes,
  categoriesOverlap,
  categoriesToHistoryTypes,
  defaultHistoryTypes,
  historyTypesToCategories,
  sameCategorySet,
  stableIdempotencyKey,
} from './historical-records.mapper';

type HistoricalRunRow =
  Database['public']['Tables']['admin_historical_data_runs']['Row'];

type CreatedCounts = {
  deposits?: number;
  withdrawals?: number;
  orders?: number;
  profits?: number;
  payments?: number;
  billing?: number;
  walletTransactions?: number;
  usdDeposits?: number;
  viewers?: number;
};

type OverviewPayload = {
  target?: {
    userId?: string;
    email?: string;
    role?: string;
    status?: string;
    merchantId?: string | null;
    storeId?: string | null;
    storeName?: string | null;
  };
  allowedCategories?: string[];
  recentRuns?: unknown[];
  [key: string]: unknown;
};

@Injectable()
export class HistoricalDataService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async overview(user: AuthenticatedUser, userId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_user_historical_overview',
      { p_user_id: userId },
    );
    const payload = (assertSupabase(
      { data, error },
      'Target account not found',
    ) ?? {}) as OverviewPayload;
    const limits = this.limits();
    const allowedCategories = Array.isArray(payload.allowedCategories)
      ? payload.allowedCategories
      : [];
    const historyTypes = availableHistoryTypes(allowedCategories);
    const target = (payload.target ?? {}) as {
      name?: string | null;
      fullName?: string | null;
      email?: string | null;
      role?: string | null;
      status?: string | null;
      merchantId?: string | null;
      storeId?: string | null;
      storeName?: string | null;
    };
    const record = {
      id: userId,
      userId,
      name: target.name ?? target.fullName ?? target.storeName ?? null,
      email: target.email ?? null,
      role: target.role ?? null,
      status: target.status ?? null,
      merchantId: target.merchantId ?? null,
      storeId: target.storeId ?? null,
      periodMonths: 6,
      allowedHistoryTypes: historyTypes
        .filter((item) => item.available)
        .map((item) => item.id)
        .join(', '),
    };

    return {
      ...payload,
      user: {
        id: userId,
        userId,
        name: record.name,
        email: record.email,
        role: record.role,
        status: record.status,
      },
      period: {
        months: 6,
        preset: 'last_180_days',
      },
      historyTypes,
      allowedCategories,
      records: [record],
      rows: [record],
      limits,
      maxDays: limits.maxDays,
    };
  }

  async preview(
    user: AuthenticatedUser,
    userId: string,
    dto: PreviewHistoricalDataDto,
  ) {
    const request = await this.normalizeRequest(user, userId, dto);
    const { data, error } = await this.client(user).rpc(
      'admin_preview_historical_data',
      this.previewArgs(request),
    );
    return assertSupabase({ data, error }, 'Target account not found');
  }

  async generate(
    user: AuthenticatedUser,
    userId: string,
    dto: GenerateHistoricalDataDto,
  ) {
    this.assertTarget(userId, dto.userId ?? userId);
    if (dto.confirm === false) {
      throw new BadRequestException('Generation requires explicit confirmation');
    }

    const request = await this.normalizeRequest(user, userId, dto);

    const existing = await this.findDuplicateRun(user, userId, request.categories);
    if (existing) {
      return { ...this.presentRun(existing), duplicate: true };
    }

    const client = this.client(user);
    const started = assertSupabase(
      await client.rpc('admin_start_historical_run', {
        ...this.previewArgs(request),
        p_confirm: true,
        p_idempotency_key: request.idempotencyKey,
      }),
      'Target account not found',
    ) as HistoricalRunRow;

    if (started.status === 'completed' || started.status === 'reversed') {
      return this.presentRun(started);
    }

    try {
      const executed = assertSupabase(
        await client.rpc('admin_execute_historical_run', {
          p_run_id: started.id,
        }),
        'Historical generation run not found',
      ) as HistoricalRunRow;
      const enriched = await this.enrichCounts(user, executed);
      return this.presentRun(enriched);
    } catch (error) {
      await client.rpc('admin_fail_historical_run', {
        p_run_id: started.id,
        p_error: this.errorMessage(error),
      });
      throw error;
    }
  }

  async listRuns(user: AuthenticatedUser, userId: string) {
    const rows = await this.loadRuns(user, userId);
    return rows.map((row) => this.presentRun(row));
  }

  async getRun(user: AuthenticatedUser, runId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_get_historical_run',
      { p_run_id: runId },
    );
    return this.presentRun(
      assertSupabase(
        { data, error },
        'Historical generation run not found',
      ) as HistoricalRunRow,
    );
  }

  async reverse(user: AuthenticatedUser, runId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_reverse_historical_run',
      { p_run_id: runId },
    );
    return this.presentRun(
      assertSupabase(
        { data, error },
        'Historical generation run not found',
      ) as HistoricalRunRow,
    );
  }

  private async normalizeRequest(
    user: AuthenticatedUser,
    pathUserId: string,
    dto: PreviewHistoricalDataDto & Partial<GenerateHistoricalDataDto>,
  ) {
    const targetUserId = dto.userId ?? pathUserId;
    this.assertTarget(pathUserId, targetUserId);

    const overview = await this.overview(user, pathUserId);
    const allowedCategories = overview.allowedCategories as string[];
    const selectedTypes =
      dto.selectAll || (!dto.categories?.length && !dto.historyTypes?.length)
        ? defaultHistoryTypes(allowedCategories)
        : (dto.historyTypes ??
          categoriesToHistoryTypes(dto.categories ?? []));
    const categories = this.uniqueCategories(
      dto.categories?.length
        ? dto.categories
        : historyTypesToCategories(selectedTypes),
    ).filter((category) => allowedCategories.includes(category));

    if (categories.length === 0) {
      throw new BadRequestException(
        'This account cannot receive the selected historical record types',
      );
    }

    return {
      userId: targetUserId,
      categories,
      historyTypes: categoriesToHistoryTypes(categories),
      activityLevel: (dto.activityLevel ??
        dto.volume ??
        'medium') as HistoricalActivityLevel,
      rangePreset: 'last_180_days' as const,
      confirm: dto.confirm !== false,
      idempotencyKey:
        dto.idempotencyKey?.trim() ||
        stableIdempotencyKey(targetUserId, categories),
    };
  }

  private async findDuplicateRun(
    user: AuthenticatedUser,
    userId: string,
    categories: readonly string[],
  ) {
    const rows = await this.loadRuns(user, userId);
    const completed = rows.find(
      (row) =>
        row.status === 'completed' &&
        !row.reversed_at &&
        sameCategorySet(row.categories, categories),
    );
    if (completed) {
      return completed;
    }

    const overlapping = rows.find(
      (row) =>
        row.status === 'completed' &&
        !row.reversed_at &&
        categoriesOverlap(row.categories, categories),
    );
    if (overlapping) {
      throw new ConflictException(
        'Historical records already exist for this account. Reverse the previous run before generating overlapping history.',
      );
    }

    return null;
  }

  private async loadRuns(user: AuthenticatedUser, userId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_list_historical_runs',
      { p_user_id: userId },
    );
    return (
      (assertSupabase({ data, error }, 'Target account not found') as
        | HistoricalRunRow[]
        | null) ?? []
    );
  }

  private async enrichCounts(user: AuthenticatedUser, row: HistoricalRunRow) {
    const { data, error } = await this.client(user).rpc(
      'admin_enrich_historical_run_counts',
      { p_run_id: row.id },
    );
    if (error || !data) {
      return row;
    }
    return {
      ...row,
      created_counts: data as HistoricalRunRow['created_counts'],
    };
  }

  private presentRun(row: HistoricalRunRow) {
    const created = (row.created_counts ?? {}) as CreatedCounts;
    const deposits = Number(created.deposits ?? 0);
    const withdrawals = Number(created.withdrawals ?? 0);
    const orders = Number(created.orders ?? 0);
    const profits = Number(created.profits ?? 0);
    const payments = Number(created.payments ?? 0);
    const walletTransactions = Number(created.walletTransactions ?? 0);
    const billing = Number(created.billing ?? walletTransactions);
    const historyTypes = categoriesToHistoryTypes(row.categories);

    return {
      id: row.id,
      runId: row.id,
      status: row.status,
      progress: row.status,
      target: {
        userId: row.target_user_id,
        merchantId: row.merchant_id,
        storeId: row.store_id,
      },
      period: {
        from: row.period_from,
        to: row.period_to,
        months: 6,
      },
      historyTypes,
      categories: row.categories,
      activityLevel: row.activity_level,
      deposits,
      withdrawals,
      orders,
      profits,
      payments,
      billing,
      walletTransactions,
      created: {
        deposits,
        withdrawals,
        orders,
        profits,
        payments,
        billing,
        walletTransactions,
      },
      processed: [
        { type: 'deposits', processed: deposits },
        { type: 'withdrawals', processed: withdrawals },
        { type: 'orders', processed: orders },
        { type: 'profits', processed: profits },
        { type: 'payments', processed: payments },
        { type: 'billing', processed: billing },
        { type: 'walletTransactions', processed: walletTransactions },
      ],
      createdCounts: row.created_counts,
      idempotencyKey: row.idempotency_key,
      error: row.error_message,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      reversedAt: row.reversed_at,
    };
  }

  private previewArgs(request: {
    userId: string;
    categories: HistoricalCategory[];
    activityLevel: HistoricalActivityLevel;
  }) {
    return {
      p_user_id: request.userId,
      p_categories: request.categories,
      p_activity_level: request.activityLevel,
      p_preset: 'last_180_days',
      p_from: undefined,
      p_to: undefined,
    };
  }

  private uniqueCategories(categories: HistoricalCategory[]) {
    return [...new Set(categories)];
  }

  private assertTarget(pathUserId: string, bodyUserId: string) {
    if (pathUserId !== bodyUserId) {
      throw new BadRequestException(
        'The request user_id must match the selected account',
      );
    }
  }

  private limits() {
    return {
      maxDays: this.configService.get<number>('historicalData.maxDays') ?? 180,
      maxDeposits:
        this.configService.get<number>('historicalData.maxDeposits') ?? 40,
      maxWithdrawals:
        this.configService.get<number>('historicalData.maxWithdrawals') ?? 20,
      maxOrders:
        this.configService.get<number>('historicalData.maxOrders') ?? 60,
      maxWalletTransactions:
        this.configService.get<number>('historicalData.maxWalletTransactions') ??
        200,
      maxTotalRows:
        this.configService.get<number>('historicalData.maxTotalRows') ?? 400,
    };
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (
        typeof response === 'object' &&
        response &&
        'message' in response &&
        typeof (response as { message: unknown }).message === 'string'
      ) {
        return (response as { message: string }).message;
      }
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Historical generation failed';
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}
