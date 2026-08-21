import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { extractSupabaseProjectRef } from '../supabase/supabase-project.util';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class SupabaseHealthIndicator {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    if (!this.supabaseService.isConfigured()) {
      return indicator.up({ configured: false });
    }

    const projectRef = extractSupabaseProjectRef(
      this.supabaseService.getPublicUrl(),
    );

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (error) {
      return indicator.down({
        message: error.message,
        projectRef: projectRef ?? undefined,
      });
    }

    return indicator.up({
      configured: true,
      projectRef: projectRef ?? undefined,
    });
  }
}
