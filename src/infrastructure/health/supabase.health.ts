import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
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

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (error) {
      return indicator.down({ message: error.message });
    }

    return indicator.up({ configured: true });
  }
}
