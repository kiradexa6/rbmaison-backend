import {
  Controller,
  Headers,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeService } from './stripe.service';

@Controller('stripe')
export class StripeWebhookController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('webhook')
  handleWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!this.stripeService.isConfigured()) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new ServiceUnavailableException(
        'Stripe webhook raw body is unavailable',
      );
    }

    return this.stripeService.handleWebhook(rawBody, signature);
  }
}
