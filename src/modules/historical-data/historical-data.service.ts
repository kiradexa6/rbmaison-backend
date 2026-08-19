import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import type { Database } from '../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  GenerateHistoricalDataDto,
  PreviewHistoricalDataDto,
} from './dto/historical-data.dto';

type HistoricalRunRow =
  Database['public']['Tables']['admin_historical_data_runs']['Row'];

type CreatedCounts = {
  deposits?: number;
  withdrawals?: number;
  orders?: number;
  walletTransactions?: number;
  usdDeposits?: number;
  viewers?: number;
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
    const payload = assertSupabase({ data, error }, 'Target account not found');
    const limits = this.limits();
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return {
        ...(payload as Record<string, unknown>),
        limits,
        maxDays: limits.maxDays,
      };
    }
    return payload;
  }

  async preview(
    user: AuthenticatedUser,
    userId: string,
    dto: PreviewHistoricalDataDto,
  ) {
    this.assertTarget(userId, dto.userId);
    const { data, error } = await this.client(user).rpc(
      'admin_preview_historical_data',
      this.previewArgs(dto),
    );
    return assertSupabase({ data, error }, 'Target account not found');
  }

  async generate(
    user: AuthenticatedUser,
    userId: string,
    dto: GenerateHistoricalDataDto,
  ) {
    this.assertTarget(userId, dto.userId);
    if (dto.confirm !== true) {
      throw new BadRequestException('Generation requires explicit confirmation');
    }

    const client = this.client(user);
    const started = assertSupabase(
      await client.rpc('admin_start_historical_run', {
        ...this.previewArgs(dto),
        p_confirm: true,
        p_idempotency_key: dto.idempotencyKey.trim(),
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
      return this.presentRun(executed);
    } catch (error) {
      await client.rpc('admin_fail_historical_run', {
        p_run_id: started.id,
        p_error: this.errorMessage(error),
      });
      throw error;
    }
  }

  async listRuns(user: AuthenticatedUser, userId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_list_historical_runs',
      { p_user_id: userId },
    );
    const rows =
      (assertSupabase({ data, error }, 'Target account not found') as
        | HistoricalRunRow[]
        | null) ?? [];
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

  private presentRun(row: HistoricalRunRow) {
    const created = (row.created_counts ?? {}) as CreatedCounts;
    return {
      runId: row.id,
      status: row.status,
      target: {
        userId: row.target_user_id,
        merchantId: row.merchant_id,
        storeId: row.store_id,
      },
      period: {
        from: row.period_from,
        to: row.period_to,
      },
      categories: row.categories,
      activityLevel: row.activity_level,
      created: {
        deposits: created.deposits ?? 0,
        withdrawals: created.withdrawals ?? 0,
        orders: created.orders ?? 0,
        walletTransactions: created.walletTransactions ?? 0,
      },
      createdCounts: row.created_counts,
      idempotencyKey: row.idempotency_key,
      error: row.error_message,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      reversedAt: row.reversed_at,
    };
  }

  private previewArgs(dto: PreviewHistoricalDataDto) {
    return {
      p_user_id: dto.userId,
      p_categories: dto.categories,
      p_activity_level: dto.activityLevel,
      p_preset: dto.rangePreset,
      p_from: dto.from ?? undefined,
      p_to: dto.to ?? undefined,
    };
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
