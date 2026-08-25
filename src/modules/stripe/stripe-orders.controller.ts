import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_ORDERS } from '../../shared/common/constants/throttle.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateStripeCheckoutDto } from './dto/stripe.dto';
import { StripeService } from './stripe.service';

@Controller('orders')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('customer')
export class StripeOrdersController {
  constructor(private readonly stripeService: StripeService) {}

  @Post(':orderId/stripe/checkout')
  @Throttle(THROTTLE_ORDERS)
  createCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateStripeCheckoutDto,
  ) {
    if (!this.stripeService.isConfigured()) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }

    return this.stripeService.createCheckoutSession(user, orderId, dto);
  }
}
