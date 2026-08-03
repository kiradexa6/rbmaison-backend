import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './infrastructure/health/health.module';
import { LoggingModule } from './infrastructure/logging/logging.module';

@Module({
  imports: [ConfigModule, LoggingModule, HealthModule],
})
export class AppModule {}
