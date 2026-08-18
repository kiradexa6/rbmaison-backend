-- R&B MAISON — merchant wholesale fulfillment and settlement
-- Extends existing orders, ledger, notifications, and admin control.
-- Confirm still debits wholesale. Admin completion returns wholesale + profit per line.

-- ---------------------------------------------------------------------------
-- Ledger: wholesale_return is a credit; unique per order line
-- ---------------------------------------------------------------------------

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_direction_consistency_chk;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_direction_consistency_chk CHECK (
    (type IN ('deposit', 'refund', 'profit_release', 'wholesale_return') AND direction = 'credit')
    OR (type IN ('withdrawal', 'order_payment') AND direction = 'debit')
    OR (type = 'admin_adjustment')
  );

CREATE OR REPLACE FUNCTION public.resolve_transaction_direction(
  p_type public.wallet_transaction_type,
  p_direction public.wallet_transaction_direction
)
RETURNS public.wallet_transaction_direction
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_type IN ('deposit', 'refund', 'profit_release', 'wholesale_return') THEN
    RETURN 'credit';
  END IF;

  IF p_type IN ('withdrawal', 'order_payment') THEN
    RETURN 'debit';
  END IF;

  IF p_direction IS NULL THEN
    RAISE EXCEPTION 'direction is required for admin_adjustment';
  END IF;

  RETURN p_direction;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_item_settlement
  ON public.wallet_transactions (type, reference_type, reference_id)
  WHERE reference_type = 'order_item'
    AND reference_id IS NOT NULL
    AND type IN ('wholesale_return', 'profit_release')
    AND status IN ('pending', 'completed');

-- ---------------------------------------------------------------------------
-- Status guard: only admin may mark completed / delivered
-- ---------------------------------------------------------------------------

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
          RAISE EXCEPTION 'Order cannot be marked paid without a wholesale ledger payment';
        END IF;
      END IF;

      IF NEW.status IN ('delivered', 'completed') AND NOT v_admin THEN
        RAISE EXCEPTION 'Only admins can complete merchant orders';
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

-- ---------------------------------------------------------------------------
-- Confirm: listing must belong to the merchant; wholesale debit unchanged
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_merchant_order(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_order public.orders;
  v_due numeric(18, 2);
  v_wallet public.wallets;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can confirm store orders';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.merchant_id IS DISTINCT FROM v_merchant_id THEN
    RAISE EXCEPTION 'Merchants can only confirm their own store orders';
  END IF;

  IF v_order.status NOT IN ('pending', 'awaiting_payment', 'confirmed') THEN
    RAISE EXCEPTION 'Illegal order status transition';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    LEFT JOIN public.merchant_product_listings mpl ON mpl.id = oi.listing_id
    WHERE oi.order_id = v_order.id
      AND (
        oi.listing_id IS NULL
        OR mpl.merchant_id IS DISTINCT FROM v_merchant_id
      )
  ) THEN
    RAISE EXCEPTION 'Product does not belong to the merchant listing';
  END IF;

  v_due := public.order_wholesale_due(v_order.id);

  IF v_due <= 0 THEN
    RAISE EXCEPTION 'Wholesale amount is required to confirm the order';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = v_order.merchant_id
    AND currency = v_order.currency
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Merchant wallet not found for order currency';
  END IF;

  IF v_wallet.balance < v_due THEN
    RAISE EXCEPTION 'Insufficient balance. Please top up your account.';
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id,
    type,
    amount,
    currency,
    direction,
    status,
    reference_type,
    reference_id,
    description
  )
  VALUES (
    v_wallet.id,
    'order_payment',
    v_due,
    v_order.currency,
    'debit',
    'completed',
    'order',
    v_order.id,
    'Wholesale payment for order ' || v_order.id::text
  );

  UPDATE public.orders
  SET status = 'paid'
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- Shipping: paid → shipping, cannot send twice
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merchant_send_for_shipping(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_order public.orders;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can send orders to shipping';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL OR v_order.merchant_id IS DISTINCT FROM v_merchant_id THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status = 'shipping' THEN
    RAISE EXCEPTION 'Order already sent for shipping';
  END IF;

  IF v_order.status NOT IN ('paid', 'processing') THEN
    RAISE EXCEPTION 'Illegal order status transition';
  END IF;

  UPDATE public.orders
  SET status = 'shipping'
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.merchant_go_for_shipping(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.merchant_send_for_shipping(p_order_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Settlement: one wholesale_return + one profit_release per order line
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_is_settled(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wallet_transactions wt
    JOIN public.order_items oi
      ON wt.reference_type = 'order_item'
     AND wt.reference_id = oi.id
    WHERE oi.order_id = p_order_id
      AND wt.type IN ('wholesale_return', 'profit_release')
      AND wt.status = 'completed'
  )
  OR EXISTS (
    SELECT 1
    FROM public.wallet_transactions wt
    WHERE wt.reference_type = 'order'
      AND wt.reference_id = p_order_id
      AND wt.type IN ('wholesale_return', 'profit_release')
      AND wt.status = 'completed'
  );
$$;

CREATE OR REPLACE FUNCTION public.release_wholesale_settlement(p_order_id uuid)
RETURNS SETOF public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_wallet public.wallets;
  v_item public.order_items;
  v_wholesale numeric(18, 2);
  v_profit numeric(18, 2);
  v_tx public.wallet_transactions;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_privileged_role() THEN
    RAISE EXCEPTION 'Only admins can release wholesale settlement';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF public.order_is_settled(v_order.id) THEN
    RAISE EXCEPTION 'Order already settled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.wallet_transactions
    WHERE reference_type = 'order'
      AND reference_id = v_order.id
      AND type = 'order_payment'
      AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Order cannot be settled without a wholesale ledger payment';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = v_order.merchant_id
    AND currency = v_order.currency
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Merchant wallet not found for order currency';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.order_items
    WHERE order_id = v_order.id
    ORDER BY created_at ASC, id ASC
  LOOP
    v_wholesale := round(v_item.wholesale_price * v_item.quantity, 2);
    v_profit := v_item.merchant_profit;

    IF v_wholesale > 0 THEN
      INSERT INTO public.wallet_transactions (
        wallet_id,
        type,
        amount,
        currency,
        direction,
        status,
        reference_type,
        reference_id,
        description
      )
      VALUES (
        v_wallet.id,
        'wholesale_return',
        v_wholesale,
        v_order.currency,
        'credit',
        'completed',
        'order_item',
        v_item.id,
        'Wholesale return for order item ' || v_item.id::text
      )
      RETURNING * INTO v_tx;

      RETURN NEXT v_tx;
    END IF;

    IF v_profit > 0 THEN
      INSERT INTO public.wallet_transactions (
        wallet_id,
        type,
        amount,
        currency,
        direction,
        status,
        reference_type,
        reference_id,
        description
      )
      VALUES (
        v_wallet.id,
        'profit_release',
        v_profit,
        v_order.currency,
        'credit',
        'completed',
        'order_item',
        v_item.id,
        'Profit release for order item ' || v_item.id::text
      )
      RETURNING * INTO v_tx;

      RETURN NEXT v_tx;
    END IF;
  END LOOP;

  RETURN;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Order already settled';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_complete_merchant_order(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can complete merchant orders';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status IN ('completed', 'delivered') OR public.order_is_settled(v_order.id) THEN
    RAISE EXCEPTION 'Order already settled';
  END IF;

  IF v_order.status NOT IN ('shipping', 'shipped') THEN
    RAISE EXCEPTION 'Illegal order status transition';
  END IF;

  PERFORM set_config('app.inventory_reference', 'order-complete:' || v_order.id::text, true);

  UPDATE public.inventory inv
  SET
    quantity = inv.quantity - oi.quantity,
    reserved_quantity = inv.reserved_quantity - oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND inv.variant_id = oi.variant_id;

  PERFORM public.release_wholesale_settlement(v_order.id);

  UPDATE public.orders
  SET status = 'completed'
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  PERFORM public.log_admin_action(
    'complete_merchant_order',
    'orders',
    v_order.id,
    'status=completed'
  );

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_confirm_delivery(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.admin_complete_merchant_order(p_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_order_profit(p_order_id uuid)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.wallet_transactions;
BEGIN
  PERFORM public.release_wholesale_settlement(p_order_id);

  SELECT wt.*
  INTO v_tx
  FROM public.wallet_transactions wt
  JOIN public.order_items oi
    ON wt.reference_type = 'order_item'
   AND wt.reference_id = oi.id
  WHERE oi.order_id = p_order_id
    AND wt.type = 'profit_release'
    AND wt.status = 'completed'
  ORDER BY wt.created_at DESC
  LIMIT 1;

  RETURN v_tx;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_merchant_id uuid;
  v_due numeric(18, 2);
  v_wallet public.wallets;
  v_paid boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_merchant_id := public.current_merchant_id();

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status IN (
    'shipping', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded'
  ) THEN
    RAISE EXCEPTION 'Order cannot be cancelled after shipping';
  END IF;

  IF public.order_is_settled(v_order.id) THEN
    RAISE EXCEPTION 'Order already settled';
  END IF;

  IF NOT public.is_admin() THEN
    IF v_merchant_id IS NOT NULL AND v_order.merchant_id = v_merchant_id THEN
      NULL;
    ELSIF auth.uid() = v_order.customer_id
          AND v_order.status IN ('pending', 'awaiting_payment') THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Not allowed to cancel this order';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.wallet_transactions
    WHERE reference_type = 'order'
      AND reference_id = v_order.id
      AND type = 'order_payment'
      AND status = 'completed'
  ) INTO v_paid;

  IF v_paid THEN
    v_due := public.order_wholesale_due(v_order.id);

    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE merchant_id = v_order.merchant_id
      AND currency = v_order.currency
    FOR UPDATE;

    INSERT INTO public.wallet_transactions (
      wallet_id,
      type,
      amount,
      currency,
      direction,
      status,
      reference_type,
      reference_id,
      description
    )
    VALUES (
      v_wallet.id,
      'refund',
      v_due,
      v_order.currency,
      'credit',
      'completed',
      'order',
      v_order.id,
      'Refund wholesale for cancelled order ' || v_order.id::text
    );
  END IF;

  UPDATE public.orders
  SET status = 'cancelled'
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin merchant-order search (product + merchant id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_merchant_orders(
  p_order_id uuid DEFAULT NULL,
  p_store_id uuid DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_product_query text DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  store_id uuid,
  store_name text,
  merchant_id uuid,
  merchant_name text,
  customer_id uuid,
  customer_name text,
  customer_email text,
  status public.order_status,
  total_amount numeric,
  currency public.supported_currency,
  created_at timestamptz,
  amount_paid numeric,
  item_id uuid,
  listing_id uuid,
  product_id uuid,
  product_name text,
  primary_image_url text,
  quantity integer,
  sales_price numeric,
  wholesale_price numeric,
  unit_profit numeric,
  merchant_profit numeric,
  amount_required numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can view merchant orders';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.store_id,
    COALESCE(s.store_name, m.store_name),
    m.id,
    COALESCE(mp.full_name, m.store_name),
    o.customer_id,
    cp.full_name,
    cp.email,
    o.status,
    o.total_amount,
    o.currency,
    o.created_at,
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.reference_type = 'order'
        AND tx.reference_id = o.id
        AND tx.type = 'order_payment'
        AND tx.status = 'completed'
    ), 0),
    oi.id,
    oi.listing_id,
    oi.product_id,
    pr.name,
    (
      SELECT coalesce(img.image_url, img.storage_path)
      FROM public.product_images img
      WHERE img.product_id = pr.id
      ORDER BY img.is_primary DESC, img.position ASC
      LIMIT 1
    ),
    oi.quantity,
    oi.sales_price,
    oi.wholesale_price,
    round(oi.sales_price - oi.wholesale_price, 2),
    oi.merchant_profit,
    round(oi.wholesale_price * oi.quantity, 2)
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.products pr ON pr.id = oi.product_id
  JOIN public.merchants m ON m.id = o.merchant_id
  LEFT JOIN public.stores s ON s.id = o.store_id
  JOIN public.profiles mp ON mp.user_id = m.user_id
  JOIN public.profiles cp ON cp.user_id = o.customer_id
  WHERE (p_order_id IS NULL OR o.id = p_order_id)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND (p_merchant_id IS NULL OR o.merchant_id = p_merchant_id)
    AND (
      p_product_query IS NULL
      OR btrim(p_product_query) = ''
      OR pr.name ILIKE '%' || btrim(p_product_query) || '%'
      OR pr.slug ILIKE '%' || btrim(p_product_query) || '%'
    )
  ORDER BY o.created_at DESC, oi.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_order_payments(p_order_id uuid)
RETURNS SETOF public.wallet_transactions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can view order payment history';
  END IF;

  RETURN QUERY
  SELECT wt.*
  FROM public.wallet_transactions wt
  WHERE (
      wt.reference_type = 'order'
      AND wt.reference_id = p_order_id
    )
    OR (
      wt.reference_type = 'order_item'
      AND wt.reference_id IN (
        SELECT oi.id FROM public.order_items oi WHERE oi.order_id = p_order_id
      )
    )
  ORDER BY wt.created_at ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- Shop stats: completed is the settled wholesale status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.shop_statistics(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  store_id uuid,
  merchant_id uuid,
  total_products_listed bigint,
  active_products bigint,
  removed_products bigint,
  total_orders bigint,
  todays_orders bigint,
  completed_orders bigint,
  pending_orders bigint,
  total_sales numeric,
  todays_sales numeric,
  total_profit numeric,
  todays_profit numeric,
  total_followers bigint,
  credit_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_merchant_id uuid;
  v_today date;
BEGIN
  v_store_id := public.resolve_shop_store_id(p_store_id);
  v_today := (timezone('utc', now()))::date;

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = v_store_id;

  RETURN QUERY
  SELECT
    v_store_id,
    v_merchant_id,
    (SELECT count(*) FROM public.merchant_product_listings mpl WHERE mpl.merchant_id = v_merchant_id),
    (SELECT count(*) FROM public.merchant_product_listings mpl WHERE mpl.merchant_id = v_merchant_id AND mpl.status = 'active'),
    (SELECT count(*) FROM public.merchant_product_listings mpl WHERE mpl.merchant_id = v_merchant_id AND mpl.status = 'removed'),
    (SELECT count(*) FROM public.orders o WHERE o.store_id = v_store_id),
    (
      SELECT count(*)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND (timezone('utc', o.created_at))::date = v_today
    ),
    (
      SELECT count(*)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('delivered', 'completed')
    ),
    (
      SELECT count(*)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('pending', 'awaiting_payment', 'confirmed')
    ),
    (
      SELECT coalesce(sum(o.total_amount), 0)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('paid', 'processing', 'shipping', 'shipped', 'delivered', 'completed')
    ),
    (
      SELECT coalesce(sum(o.total_amount), 0)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('paid', 'processing', 'shipping', 'shipped', 'delivered', 'completed')
        AND (timezone('utc', o.created_at))::date = v_today
    ),
    (
      SELECT coalesce(sum(oi.merchant_profit), 0)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.store_id = v_store_id
        AND o.status IN ('delivered', 'completed')
    ),
    (
      SELECT coalesce(sum(oi.merchant_profit), 0)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.store_id = v_store_id
        AND o.status IN ('delivered', 'completed')
        AND (timezone('utc', o.updated_at))::date = v_today
    ),
    (SELECT count(*) FROM public.store_followers sf WHERE sf.store_id = v_store_id),
    public.current_merchant_credit_score(v_merchant_id);
END;
$$;

DROP FUNCTION IF EXISTS public.shop_financials(uuid);

CREATE OR REPLACE FUNCTION public.shop_financials(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  currency public.supported_currency,
  wallet_id uuid,
  wallet_balance numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  order_payments numeric,
  profit_releases numeric,
  refunds numeric,
  wholesale_returns numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_merchant_id uuid;
BEGIN
  v_store_id := public.resolve_shop_store_id(p_store_id);

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = v_store_id;

  RETURN QUERY
  SELECT
    w.currency,
    w.id,
    w.balance,
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'deposit'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'withdrawal'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'order_payment'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'profit_release'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'refund'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'wholesale_return'
    ), 0)
  FROM public.wallets w
  WHERE w.merchant_id = v_merchant_id
  ORDER BY w.currency;
END;
$$;

-- ---------------------------------------------------------------------------
-- Notifications for the wholesale cycle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_new_order_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_user_id uuid;
BEGIN
  v_user_id := public.merchant_user_id(NEW.merchant_id);
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_payload := public.order_notification_payload(NEW.id);

  PERFORM public.create_notification(
    v_user_id,
    'new_order',
    'New Order',
    'New order received',
    v_payload
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_order_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_user_id uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_user_id := public.merchant_user_id(NEW.merchant_id);
  v_payload := public.order_notification_payload(NEW.id);

  IF NEW.status = 'paid' THEN
    PERFORM public.create_notification(
      v_user_id,
      'order_paid',
      'Wholesale Payment Completed',
      'Order confirmed and wholesale payment completed',
      v_payload
    );
  ELSIF NEW.status = 'shipping' THEN
    PERFORM public.create_notification(
      v_user_id,
      'shipping_confirmed',
      'Order Sent For Shipping',
      'Order sent for shipping',
      v_payload
    );
    PERFORM public.notify_admins(
      'shipping_confirmed',
      'Merchant Order Waiting For Confirmation',
      'Merchant order waiting for confirmation',
      v_payload
    );
  ELSIF NEW.status IN ('completed', 'delivered') THEN
    PERFORM public.create_notification(
      v_user_id,
      'delivery_completed',
      'Order Completed',
      'Order completed. Wholesale returned and profit released.',
      v_payload
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_profit_release_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.type <> 'profit_release'
     OR NEW.status <> 'completed'
     OR NEW.reference_type = 'order_item' THEN
    RETURN NEW;
  END IF;

  SELECT m.user_id INTO v_user_id
  FROM public.wallets w
  JOIN public.merchants m ON m.id = w.merchant_id
  WHERE w.id = NEW.wallet_id;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.create_notification(
    v_user_id,
    'profit_released',
    'Profit Released',
    'Order completed. Wholesale returned and profit released.',
    jsonb_build_object(
      'amount', NEW.amount,
      'currency', NEW.currency,
      'order_id', NEW.reference_id,
      'transaction_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_send_for_shipping(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_complete_merchant_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_wholesale_settlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.order_is_settled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_merchant_orders(uuid, uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.merchant_send_for_shipping(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_complete_merchant_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_wholesale_settlement(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_is_settled(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_merchant_orders(uuid, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.shop_financials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_financials(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.release_wholesale_settlement(uuid) IS
  'Credits wholesale_return and profit_release per order line. Idempotent: duplicate settlement raises Order already settled.';
COMMENT ON FUNCTION public.admin_complete_merchant_order(uuid) IS
  'Admin-only shipping → completed. Settles wholesale return + 20% profit through the ledger.';
