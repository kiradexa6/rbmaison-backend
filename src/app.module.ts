import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './infrastructure/health/health.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import {
  THROTTLE_DEFAULT_LIMIT,
  THROTTLE_TTL_MS,
} from './shared/common/constants/throttle.constants';

import { ProductsModule } from './modules/products/products.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { OrdersModule } from './modules/orders/orders.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { HistoricalDataModule } from './modules/historical-data/historical-data.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: THROTTLE_TTL_MS, limit: THROTTLE_DEFAULT_LIMIT }],
    }),
    SupabaseModule,
    AuthModule,
    ProductsModule,
    MerchantsModule,
    OrdersModule,
    WalletsModule,
    NotificationsModule,
    HistoricalDataModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
