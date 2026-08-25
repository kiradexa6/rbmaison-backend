import { BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'customer@rbmaison.test',
  role: 'customer' as const,
  status: 'active',
  accessToken: 'customer-token',
};

describe('StripeService', () => {
  it('verifies webhook signatures and completes payments', async () => {
    const constructEvent = jest.fn().mockReturnValue({
      id: 'evt_123',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
        },
      },
    });

    const rpc = jest.fn().mockResolvedValue({
      data: { id: 'pay_1', status: 'succeeded' },
      error: null,
    });

    const service = new StripeService(
      {
        get: jest.fn((key: string) => {
          if (key === 'stripe.secretKey') {
            return 'sk_test_123';
          }
          if (key === 'stripe.webhookSecret') {
            return 'whsec_123';
          }
          return undefined;
        }),
      } as never,
      {
        isConfigured: () => true,
        getAdminClient: () => ({ rpc }),
      } as never,
    );

    (service as unknown as { stripe: Stripe }).stripe = {
      webhooks: { constructEvent },
    } as unknown as Stripe;

    const result = await service.handleWebhook(
      Buffer.from('{}'),
      'sig_header',
    );

    expect(constructEvent).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('complete_stripe_order_payment', {
      p_stripe_payment_intent_id: 'pi_123',
      p_stripe_event_id: 'evt_123',
    });
    expect(result.eventId).toBe('evt_123');
  });

  it('rejects checkout creation for non-USD orders', async () => {
    const service = new StripeService(
      {
        get: jest.fn((key: string) =>
          key === 'stripe.secretKey' ? 'sk_test_123' : undefined,
        ),
      } as never,
      {
        isConfigured: () => true,
        asUser: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: 'order-id',
                    customer_id: user.id,
                    status: 'pending',
                    total_amount: '1200.00',
                    currency: 'BTC',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      } as never,
    );

    await expect(
      service.createCheckoutSession(user, 'order-id', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
