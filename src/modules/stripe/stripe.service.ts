import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import { CreateStripeCheckoutDto } from './dto/stripe.dto';

type OrderRow = {
  id: string;
  customer_id: string;
  status: string;
  total_amount: string | number;
  currency: string;
};

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('stripe.secretKey'));
  }

  private client(): Stripe {
    const secretKey = this.configService.get<string>('stripe.secretKey');
    if (!secretKey) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }

    if (!this.stripe) {
      this.stripe = new Stripe(secretKey);
    }

    return this.stripe;
  }

  async createCheckoutSession(
    user: AuthenticatedUser,
    orderId: string,
    dto: CreateStripeCheckoutDto,
  ) {
    this.ensureSupabase();

    const order = await this.loadCustomerOrder(user, orderId);
    this.assertPayableOrder(order);

    if (order.currency !== 'USD') {
      throw new BadRequestException(
        'Stripe checkout is only available for USD orders',
      );
    }

    const amountCents = this.toStripeAmount(order.total_amount);
    const stripe = this.client();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: order.currency.toLowerCase(),
            unit_amount: amountCents,
            product_data: {
              name: 'R&B Maison order',
              description: `Order ${order.id}`,
            },
          },
        },
      ],
      metadata: {
        order_id: order.id,
        customer_id: user.id,
      },
      success_url: dto.successUrl ?? 'https://rbmaisons.com/account/orders',
      cancel_url: dto.cancelUrl ?? 'https://rbmaisons.com/account/orders',
    });

    const expanded = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['payment_intent'],
    });

    const paymentIntentId = this.extractPaymentIntentId(expanded);
    if (!paymentIntentId) {
      throw new BadRequestException(
        'Stripe did not return a payment intent for this checkout session',
      );
    }

    const { data, error } = await this.adminClient().rpc(
      'register_stripe_payment_attempt',
      {
        p_order_id: order.id,
        p_customer_id: user.id,
        p_stripe_payment_intent_id: paymentIntentId,
        p_stripe_checkout_session_id: session.id,
        p_amount: Number(order.total_amount),
        p_currency: order.currency,
      },
    );

    const row = assertSupabase({ data, error });

    return {
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
      paymentIntentId,
      stripePaymentId: paymentIntentId,
      paymentRecordId: (row as { id?: string } | null)?.id ?? null,
      orderId: order.id,
      amount: String(order.total_amount),
      currency: order.currency,
      status: 'pending',
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const webhookSecret = this.configService.get<string>('stripe.webhookSecret');
    if (!webhookSecret) {
      throw new ServiceUnavailableException(
        'Stripe webhook secret is not configured',
      );
    }

    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }

    const stripe = this.client();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event);
        break;
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event);
        break;
      default:
        this.logger.debug(`Ignoring unsupported Stripe event ${event.type}`);
    }

    return { received: true, eventId: event.id, type: event.type };
  }

  private async handleCheckoutSessionCompleted(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== 'paid') {
      return;
    }

    const paymentIntentId = this.extractPaymentIntentId(session);
    if (!paymentIntentId) {
      throw new BadRequestException(
        'Checkout session completed without a payment intent id',
      );
    }

    await this.completePayment(paymentIntentId, event.id);
  }

  private async handlePaymentIntentSucceeded(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await this.completePayment(paymentIntent.id, event.id);
  }

  private async handlePaymentIntentFailed(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const lastError = paymentIntent.last_payment_error;

    await this.failPayment(
      paymentIntent.id,
      event.id,
      lastError?.code ?? undefined,
      lastError?.message ?? undefined,
    );
  }

  private async completePayment(paymentIntentId: string, eventId: string) {
    const { data, error } = await this.adminClient().rpc(
      'complete_stripe_order_payment',
      {
        p_stripe_payment_intent_id: paymentIntentId,
        p_stripe_event_id: eventId,
      },
    );

    assertSupabase({ data, error });
  }

  private async failPayment(
    paymentIntentId: string,
    eventId: string,
    failureCode?: string,
    failureMessage?: string,
  ) {
    const { data, error } = await this.adminClient().rpc(
      'fail_stripe_order_payment',
      {
        p_stripe_payment_intent_id: paymentIntentId,
        p_stripe_event_id: eventId,
        p_failure_code: failureCode ?? undefined,
        p_failure_message: failureMessage ?? undefined,
      },
    );

    assertSupabase({ data, error });
  }

  private async loadCustomerOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderRow> {
    const { data, error } = await this.supabaseService
      .asUser(user.accessToken)
      .from('orders')
      .select('id, customer_id, status, total_amount, currency')
      .eq('id', orderId)
      .maybeSingle();

    const order = assertSupabase({ data, error }, 'Order not found');
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.customer_id !== user.id) {
      throw new NotFoundException('Order not found');
    }

    return order as OrderRow;
  }

  private assertPayableOrder(order: OrderRow) {
    if (!['pending', 'awaiting_payment'].includes(order.status)) {
      throw new BadRequestException('Order is not awaiting customer payment');
    }
  }

  private extractPaymentIntentId(
    session: Pick<Stripe.Checkout.Session, 'payment_intent'>,
  ): string | null {
    if (!session.payment_intent) {
      return null;
    }

    return typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent.id;
  }

  private toStripeAmount(totalAmount: string | number): number {
    const amount = Number(totalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Order total is invalid for Stripe checkout');
    }

    return Math.round(amount * 100);
  }

  private ensureSupabase() {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
  }

  private adminClient() {
    return this.supabaseService.getAdminClient();
  }
}
