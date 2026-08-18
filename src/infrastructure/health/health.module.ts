import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { SupabaseHealthIndicator } from './supabase.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [SupabaseHealthIndicator],
})
export class HealthModule {}
