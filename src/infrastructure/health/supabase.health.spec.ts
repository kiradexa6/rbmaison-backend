import { HealthIndicatorService } from '@nestjs/terminus';
import { SupabaseHealthIndicator } from './supabase.health';
import { SupabaseService } from '../supabase/supabase.service';

describe('SupabaseHealthIndicator', () => {
  function indicator(supabase: Partial<SupabaseService>) {
    const up = jest.fn((data?: Record<string, unknown>) => ({
      supabase: { status: 'up', ...data },
    }));
    const down = jest.fn((data?: Record<string, unknown>) => ({
      supabase: { status: 'down', ...data },
    }));
    const healthIndicatorService = {
      check: jest.fn().mockReturnValue({ up, down }),
    } as unknown as HealthIndicatorService;

    return {
      up,
      health: new SupabaseHealthIndicator(
        supabase as SupabaseService,
        healthIndicatorService,
      ),
    };
  }

  it('reports supabase as not configured when credentials are missing', async () => {
    const { health, up } = indicator({
      isConfigured: () => false,
    });

    const result = await health.isHealthy('supabase');

    expect(up).toHaveBeenCalledWith({ configured: false });
    expect(result).toEqual({ supabase: { status: 'up', configured: false } });
  });

  it('reports supabase as configured when production variables are supplied and reachable', async () => {
    const from = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ error: null }),
    });
    const { health, up } = indicator({
      isConfigured: () => true,
      getPublicUrl: () => 'https://sbcyoaswsjfhhkypdniu.supabase.co',
      getAdminClient: () => ({ from }) as never,
    });

    const result = await health.isHealthy('supabase');

    expect(from).toHaveBeenCalledWith('profiles');
    expect(up).toHaveBeenCalledWith({
      configured: true,
      projectRef: 'sbcyoaswsjfhhkypdniu',
    });
    expect(result).toEqual({
      supabase: {
        status: 'up',
        configured: true,
        projectRef: 'sbcyoaswsjfhhkypdniu',
      },
    });
  });
});
