import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminStoresService } from '../merchants/admin-stores.service';
import { mapSupabaseError } from '../products/supabase-error';
import { AuthService } from '../auth/auth.service';
import { HistoricalDataService } from './historical-data.service';
import { THROTTLE_HISTORICAL_LIMIT } from '../../shared/common/constants/throttle.constants';

const admin: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@rbmaison.test',
  role: 'admin',
  status: 'active',
  accessToken: 'admin-token',
};

const merchant: AuthenticatedUser = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'merchant@rbmaison.test',
  role: 'merchant',
  status: 'active',
  accessToken: 'merchant-token',
};

const customer: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'customer@rbmaison.test',
  role: 'customer',
  status: 'active',
  accessToken: 'customer-token',
};

const otherUserId = '33333333-3333-4333-8333-333333333333';
const storeId = '99999999-9999-4999-8999-999999999999';
const merchantId = '77777777-7777-4777-8777-777777777777';
const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const previewDto = {
  userId: merchant.id,
  categories: ['deposits', 'orders'] as const,
  activityLevel: 'medium' as const,
  rangePreset: 'last_30_days' as const,
};

const generateDto = {
  ...previewDto,
  categories: [...previewDto.categories],
  confirm: true,
  idempotencyKey: 'hist-run-2026-08-19-001',
};

function configService(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      const values: Record<string, number> = {
        'historicalData.maxDays': 180,
        'historicalData.maxDeposits': 40,
        'historicalData.maxWithdrawals': 20,
        'historicalData.maxOrders': 60,
        'historicalData.maxWalletTransactions': 200,
        'historicalData.maxTotalRows': 400,
      };
      return values[key];
    }),
  } as never;
}

function serviceOf(client: unknown): HistoricalDataService {
  return new HistoricalDataService(
    {
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never,
    configService(),
  );
}

function completedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    admin_id: admin.id,
    target_user_id: merchant.id,
    merchant_id: merchantId,
    store_id: storeId,
    period_from: '2026-02-19T00:00:00.000Z',
    period_to: '2026-08-19T00:00:00.000Z',
    categories: ['deposits', 'orders'],
    activity_level: 'medium',
    idempotency_key: generateDto.idempotencyKey,
    status: 'completed',
    created_counts: {
      deposits: 12,
      withdrawals: 0,
      orders: 16,
      walletTransactions: 40,
    },
    created_ids: {},
    snapshot: {},
    error_message: null,
    created_at: '2026-08-19T10:00:00.000Z',
    completed_at: '2026-08-19T10:01:00.000Z',
    reversed_at: null,
    ...overrides,
  };
}

function roleContext(role: AuthenticatedUser['role'], required: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  };
  const guard = new RolesGuard(reflector as never);
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/v1/admin/users/id/historical-data/generate',
        ip: '127.0.0.1',
        user: {
          id: 'user',
          email: 'u@test',
          role,
          status: 'active',
          accessToken: 't',
        },
      }),
    }),
  };
  return { guard, context };
}

describe('admin historical data generator', () => {
  it('resolves the selected account before preview', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: {
          status: 'preview',
          target: { userId: merchant.id, email: merchant.email },
          estimated: { deposits: 15, orders: 16 },
        },
        error: null,
      }),
    };
    const result = await serviceOf(client).preview(admin, merchant.id, {
      ...previewDto,
      categories: [...previewDto.categories],
    });

    expect(client.rpc).toHaveBeenCalledWith(
      'admin_preview_historical_data',
      expect.objectContaining({ p_user_id: merchant.id }),
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      'admin_execute_historical_run',
      expect.anything(),
    );
    expect(result.status).toBe('preview');
  });

  it('rejects a body user_id that does not match the selected account', async () => {
    const client = { rpc: jest.fn() };
    await expect(
      serviceOf(client).preview(admin, merchant.id, {
        ...previewDto,
        userId: otherUserId,
        categories: [...previewDto.categories],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before generation', async () => {
    const client = { rpc: jest.fn() };
    await expect(
      serviceOf(client).generate(admin, merchant.id, {
        ...generateDto,
        confirm: false,
      }),
    ).rejects.toThrow(/explicit confirmation/);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('generates history only for the selected existing account', async () => {
    const client = {
      rpc: jest.fn(async (name: string) => {
        if (name === 'admin_start_historical_run') {
          return { data: { ...completedRun(), status: 'running' }, error: null };
        }
        if (name === 'admin_execute_historical_run') {
          return { data: completedRun(), error: null };
        }
        return { data: null, error: null };
      }),
    };

    const result = await serviceOf(client).generate(admin, merchant.id, generateDto);

    expect(client.rpc).toHaveBeenCalledWith(
      'admin_start_historical_run',
      expect.objectContaining({
        p_user_id: merchant.id,
        p_confirm: true,
        p_idempotency_key: generateDto.idempotencyKey,
      }),
    );
    expect(client.rpc).toHaveBeenCalledWith('admin_execute_historical_run', {
      p_run_id: runId,
    });
    expect(result.target.userId).toBe(merchant.id);
    expect(result.target.userId).not.toBe(otherUserId);
    expect(result.created.orders).toBe(16);
    expect(result.created.deposits).toBe(12);
  });

  it('returns the existing run when an idempotent generate is retried', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: completedRun(), error: null }),
    };

    const result = await serviceOf(client).generate(admin, merchant.id, generateDto);

    expect(client.rpc).toHaveBeenCalledWith(
      'admin_start_historical_run',
      expect.anything(),
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      'admin_execute_historical_run',
      expect.anything(),
    );
    expect(result.status).toBe('completed');
    expect(result.runId).toBe(runId);
  });

  it('marks the run failed and rolls back generation when execute errors', async () => {
    const client = {
      rpc: jest.fn(async (name: string) => {
        if (name === 'admin_start_historical_run') {
          return { data: { ...completedRun(), status: 'running' }, error: null };
        }
        if (name === 'admin_execute_historical_run') {
          return {
            data: null,
            error: { message: 'Wallet accounting is inconsistent after historical generation' },
          };
        }
        return { data: { ...completedRun(), status: 'failed' }, error: null };
      }),
    };

    await expect(
      serviceOf(client).generate(admin, merchant.id, generateDto),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(client.rpc).toHaveBeenCalledWith('admin_fail_historical_run', {
      p_run_id: runId,
      p_error: 'Wallet accounting is inconsistent after historical generation',
    });
  });

  it('blocks customers and merchants from the admin generator', () => {
    expect(() =>
      roleContext('customer', ['admin']).guard.canActivate(
        roleContext('customer', ['admin']).context as never,
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      roleContext('merchant', ['admin']).guard.canActivate(
        roleContext('merchant', ['admin']).context as never,
      ),
    ).toThrow(/Permission denied/);
  });

  it('rejects ranges older than six months and future dates', () => {
    expect(
      mapSupabaseError(
        { message: 'Historical range cannot exceed 6 months' },
        'not found',
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      mapSupabaseError(
        { message: 'Future dates are not allowed' },
        'not found',
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate in-flight generation', () => {
    expect(
      mapSupabaseError(
        { message: 'A historical generation is already running for this account' },
        'not found',
      ),
    ).toBeInstanceOf(ConflictException);
  });

  it('returns a clear error when the merchant has no eligible products', () => {
    expect(
      mapSupabaseError(
        {
          message:
            'This merchant has no eligible products available for historical order generation.',
        },
        'not found',
      ).message,
    ).toMatch(/no eligible products/);
  });

  it('refuses unsafe reversal', () => {
    expect(
      mapSupabaseError(
        {
          message:
            'This run cannot be safely reversed because generated orders have entered the payment or fulfillment lifecycle.',
        },
        'not found',
      ),
    ).toBeInstanceOf(UnprocessableEntityException);
  });

  it('lists and loads generation runs for the selected account only', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [completedRun()], error: null }),
    };
    const rows = await serviceOf(client).listRuns(admin, merchant.id);
    expect(client.rpc).toHaveBeenCalledWith('admin_list_historical_runs', {
      p_user_id: merchant.id,
    });
    expect(rows[0]?.target.userId).toBe(merchant.id);
  });

  it('reverses a completed run through the admin RPC', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: completedRun({ status: 'reversed', reversed_at: '2026-08-19T11:00:00.000Z' }),
        error: null,
      }),
    };
    const result = await serviceOf(client).reverse(admin, runId);
    expect(client.rpc).toHaveBeenCalledWith('admin_reverse_historical_run', {
      p_run_id: runId,
    });
    expect(result.status).toBe('reversed');
  });

  it('throttles generate, preview, and reverse tighter than ordinary reads', () => {
    expect(THROTTLE_HISTORICAL_LIMIT).toBe(3);
    expect(THROTTLE_HISTORICAL_LIMIT).toBeLessThan(10);
  });

  it('does not generate history during signup', async () => {
    const asUser = jest.fn();
    const anon = {
      auth: {
        signUp: jest.fn().mockResolvedValue({
          data: { user: { id: customer.id }, session: null },
          error: null,
        }),
      },
    };
    const service = new AuthService({
      isConfigured: () => true,
      getAnonClient: jest.fn().mockReturnValue(anon),
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    await service.signup({
      email: 'newuser@example.com',
      password: 'a-very-long-password',
    });

    expect(anon.auth.signUp).toHaveBeenCalled();
    expect(asUser).not.toHaveBeenCalled();
  });
});

describe('admin store viewer adjustments', () => {
  it('sets the displayed store viewer count through the admin RPC', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { store_id: storeId, viewer_count: 1280, reason: 'Campaign display' },
        error: null,
      }),
    };
    const service = new AdminStoresService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.adjustViewers(admin, storeId, {
      viewerCount: 1280,
      reason: 'Campaign display',
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_adjust_store_viewers', {
      p_store_id: storeId,
      p_viewer_count: 1280,
      p_reason: 'Campaign display',
    });
    expect(result.viewer_count).toBe(1280);
  });
});
