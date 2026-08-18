import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './infrastructure/health/health.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';

@Module({
  imports: [ConfigModule, LoggingModule, SupabaseModule, HealthModule],
})
export class AppModule {}
