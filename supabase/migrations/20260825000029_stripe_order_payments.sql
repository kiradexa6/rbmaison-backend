-- Stripe customer checkout for existing orders (no wallet ledger changes).

CREATE TYPE public.stripe_payment_status AS ENUM (
  'pending',
  'processing',
  'succeeded',
  'failed',
  'canceled'
);

CREATE TABLE public.order_stripe_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  amount numeric(18, 2) NOT NULL,
  currency public.supported_currency NOT NULL DEFAULT 'USD',
  status public.stripe_payment_status NOT NULL DEFAULT 'pending',
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_stripe_payments_amount_chk CHECK (amount > 0),
  CONSTRAINT order_stripe_payments_intent_unique UNIQUE (stripe_payment_intent_id),
  CONSTRAINT order_stripe_payments_session_unique UNIQUE (stripe_checkout_session_id)
);

CREATE UNIQUE INDEX idx_order_stripe_payments_one_success_per_order
  ON public.order_stripe_payments (order_id)
  WHERE status = 'succeeded';

CREATE INDEX idx_order_stripe_payments_order_id
  ON public.order_stripe_payments (order_id);

CREATE INDEX idx_order_stripe_payments_status
  ON public.order_stripe_payments (status);

CREATE TABLE public.stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_stripe_payments IS
  'Customer card payments through Stripe for existing orders. Separate from merchant wholesale wallet debits.';

COMMENT ON TABLE public.stripe_webhook_events IS
  'Processed Stripe webhook event IDs for idempotent handling.';

CREATE TRIGGER trg_order_stripe_payments_set_updated_at
  BEFORE UPDATE ON public.order_stripe_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.order_stripe_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_stripe_payments_customer_read ON public.order_stripe_payments
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid() OR public.is_admin());

CREATE POLICY stripe_webhook_events_admin_read ON public.stripe_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Allow Stripe completion to move pending/awaiting_payment -> confirmed (customer paid).
CREATE OR REPLACE FUNCTION public.protect_order_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
  v_merchant_id uuid;
  v_paid boolean;
BEGIN
  v_admin := public.is_admin();
  v_merchant_id := public.current_merchant_id();

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Orders cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
       OR NEW.store_id IS DISTINCT FROM OLD.store_id
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Order commercial fields are immutable';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.wallet_transactions tx
          WHERE tx.reference_type = 'order'
            AND tx.reference_id = NEW.id
            AND tx.type = 'order_payment'
            AND tx.status = 'completed'
        ) INTO v_paid;

        IF NOT v_paid THEN
          SELECT EXISTS (
            SELECT 1
            FROM public.order_stripe_payments osp
            WHERE osp.order_id = NEW.id
              AND osp.status = 'succeeded'
          ) INTO v_paid;

          IF NOT v_paid THEN
            RAISE EXCEPTION 'Order cannot be marked paid without a completed payment';
          END IF;
        END IF;
      END IF;

      IF NEW.status = 'delivered' AND NOT v_admin THEN
        RAISE EXCEPTION 'Only admins can confirm delivery';
      END IF;

      IF v_admin THEN
        RETURN NEW;
      END IF;

      IF auth.uid() = OLD.customer_id
         AND OLD.status IN ('pending', 'awaiting_payment')
         AND NEW.status = 'cancelled' THEN
        RETURN NEW;
      END IF;

      IF v_merchant_id IS NOT NULL AND OLD.merchant_id = v_merchant_id THEN
        IF OLD.status IN ('pending', 'awaiting_payment', 'confirmed')
           AND NEW.status IN ('paid', 'cancelled') THEN
          RETURN NEW;
        END IF;

        IF OLD.status = 'paid' AND NEW.status IN ('processing', 'shipping', 'cancelled') THEN
          RETURN NEW;
        END IF;

        IF OLD.status = 'processing' AND NEW.status IN ('shipping', 'cancelled') THEN
          RETURN NEW;
        END IF;
      END IF;

      RAISE EXCEPTION 'Illegal order status transition';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_stripe_payment_attempt(
  p_order_id uuid,
  p_customer_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_checkout_session_id text,
  p_amount numeric,
  p_currency public.supported_currency DEFAULT 'USD'
)
RETURNS public.order_stripe_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_payment public.order_stripe_payments;
BEGIN
  IF p_stripe_payment_intent_id IS NULL OR btrim(p_stripe_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'Stripe payment intent id is required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Order does not belong to this customer';
  END IF;

  IF v_order.status NOT IN ('pending', 'awaiting_payment') THEN
    RAISE EXCEPTION 'Order is not awaiting customer payment';
  END IF;

  IF v_order.currency IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'Stripe payment currency must match the order currency';
  END IF;

  IF round(v_order.total_amount, 2) IS DISTINCT FROM round(p_amount, 2) THEN
    RAISE EXCEPTION 'Stripe payment amount must match the order total';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_stripe_payments osp
    WHERE osp.order_id = p_order_id
      AND osp.status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'Order already has a successful Stripe payment';
  END IF;

  INSERT INTO public.order_stripe_payments (
    order_id,
    customer_id,
    stripe_payment_intent_id,
    stripe_checkout_session_id,
    amount,
    currency,
    status
  )
  VALUES (
    p_order_id,
    p_customer_id,
    p_stripe_payment_intent_id,
    NULLIF(btrim(p_stripe_checkout_session_id), ''),
    p_amount,
    p_currency,
    'pending'
  )
  ON CONFLICT (stripe_payment_intent_id) DO UPDATE
  SET
    stripe_checkout_session_id = COALESCE(
      EXCLUDED.stripe_checkout_session_id,
      public.order_stripe_payments.stripe_checkout_session_id
    ),
    updated_at = now()
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stripe_order_payment(
  p_stripe_payment_intent_id text,
  p_stripe_event_id text DEFAULT NULL
)
RETURNS public.order_stripe_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.order_stripe_payments;
  v_order public.orders;
BEGIN
  IF p_stripe_payment_intent_id IS NULL OR btrim(p_stripe_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'Stripe payment intent id is required';
  END IF;

  IF p_stripe_event_id IS NOT NULL AND btrim(p_stripe_event_id) <> '' THEN
    INSERT INTO public.stripe_webhook_events (stripe_event_id, event_type)
    VALUES (btrim(p_stripe_event_id), 'payment_succeeded')
    ON CONFLICT (stripe_event_id) DO NOTHING;

    IF NOT FOUND THEN
      SELECT * INTO v_payment
      FROM public.order_stripe_payments
      WHERE stripe_payment_intent_id = btrim(p_stripe_payment_intent_id);

      IF v_payment.id IS NOT NULL THEN
        RETURN v_payment;
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_payment
  FROM public.order_stripe_payments
  WHERE stripe_payment_intent_id = btrim(p_stripe_payment_intent_id)
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Stripe payment record not found';
  END IF;

  IF v_payment.status = 'succeeded' THEN
    RETURN v_payment;
  END IF;

  UPDATE public.order_stripe_payments
  SET
    status = 'succeeded',
    failure_code = NULL,
    failure_message = NULL
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_payment.order_id
  FOR UPDATE;

  IF v_order.status IN ('pending', 'awaiting_payment') THEN
    UPDATE public.orders
    SET status = 'paid'
    WHERE id = v_order.id;
  END IF;

  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_stripe_order_payment(
  p_stripe_payment_intent_id text,
  p_stripe_event_id text DEFAULT NULL,
  p_failure_code text DEFAULT NULL,
  p_failure_message text DEFAULT NULL
)
RETURNS public.order_stripe_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.order_stripe_payments;
BEGIN
  IF p_stripe_payment_intent_id IS NULL OR btrim(p_stripe_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'Stripe payment intent id is required';
  END IF;

  IF p_stripe_event_id IS NOT NULL AND btrim(p_stripe_event_id) <> '' THEN
    INSERT INTO public.stripe_webhook_events (stripe_event_id, event_type)
    VALUES (btrim(p_stripe_event_id), 'payment_failed')
    ON CONFLICT (stripe_event_id) DO NOTHING;

    IF NOT FOUND THEN
      SELECT * INTO v_payment
      FROM public.order_stripe_payments
      WHERE stripe_payment_intent_id = btrim(p_stripe_payment_intent_id);

      IF v_payment.id IS NOT NULL THEN
        RETURN v_payment;
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_payment
  FROM public.order_stripe_payments
  WHERE stripe_payment_intent_id = btrim(p_stripe_payment_intent_id)
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Stripe payment record not found';
  END IF;

  IF v_payment.status = 'succeeded' THEN
    RETURN v_payment;
  END IF;

  UPDATE public.order_stripe_payments
  SET
    status = 'failed',
    failure_code = NULLIF(btrim(p_failure_code), ''),
    failure_message = NULLIF(btrim(p_failure_message), '')
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.register_stripe_payment_attempt(uuid, uuid, text, text, numeric, public.supported_currency) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_stripe_order_payment(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_stripe_order_payment(text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_stripe_payment_attempt(uuid, uuid, text, text, numeric, public.supported_currency) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_order_payment(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_stripe_order_payment(text, text, text, text) TO service_role;
