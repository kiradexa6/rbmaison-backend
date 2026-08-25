import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { StripeOrdersController } from './stripe-orders.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [AuthModule, SupabaseModule],
  controllers: [StripeOrdersController, StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
