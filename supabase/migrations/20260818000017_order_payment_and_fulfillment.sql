-- R&B MAISON — production order flow
-- Uses existing orders, order_items, listings, wallets, and the ledger.
-- Merchant pays wholesale on confirm; sales settlement is released only after delivery.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES public.merchant_product_listings (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_order_items_listing_id ON public.order_items (listing_id);

COMMENT ON COLUMN public.order_items.listing_id IS
  'Merchant listing snapshotted at order time. Sales and wholesale come from the listing, not the client.';

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_direction_consistency_chk;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_direction_consistency_chk CHECK (
    (type IN ('deposit', 'refund', 'profit_release') AND direction = 'credit')
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
  IF p_type IN ('deposit', 'refund', 'profit_release') THEN
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

CREATE OR REPLACE FUNCTION public.apply_wallet_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_delta numeric(36, 18);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ledger transactions cannot be deleted';
  END IF;

  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be greater than zero';
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE id = NEW.wallet_id
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_wallet.currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'Transaction currency must match wallet currency';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.direction IS DISTINCT FROM OLD.direction
       OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
       OR NEW.reference_id IS DISTINCT FROM OLD.reference_id THEN
      RAISE EXCEPTION 'Ledger transaction fields are immutable';
    END IF;

    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'Completed ledger transactions cannot be modified';
    END IF;

    IF OLD.status IN ('failed', 'cancelled')
       AND NEW.status = 'completed' THEN
      RAISE EXCEPTION 'Terminal transactions cannot be completed';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.status = 'completed')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    v_delta := public.wallet_transaction_delta(NEW.direction, NEW.amount);

    IF v_wallet.balance + v_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient balance. Please top up your account.';
    END IF;

    UPDATE public.wallets
    SET balance = balance + v_delta
    WHERE id = NEW.wallet_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Status transitions
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

CREATE OR REPLACE VIEW public.customer_order_items
WITH (security_barrier = true) AS
SELECT
  oi.id,
  oi.order_id,
  oi.product_id,
  oi.variant_id,
  oi.quantity,
  oi.sales_price,
  oi.created_at,
  oi.listing_id
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
WHERE o.customer_id = auth.uid();

GRANT SELECT ON public.customer_order_items TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Place order: snapshot listing prices, never accept client money fields
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_order(
  p_merchant_id uuid,
  p_items jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_store public.stores;
  v_merchant public.merchants;
  v_order public.orders;
  v_item jsonb;
  v_listing_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_listing public.merchant_product_listings;
  v_variant public.product_variants;
  v_inventory public.inventory;
  v_total numeric(18, 2) := 0;
  v_prepared jsonb := '[]'::jsonb;
BEGIN
  v_customer_id := auth.uid();

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_customer() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only customers can place orders';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  SELECT * INTO v_merchant
  FROM public.merchants
  WHERE id = p_merchant_id
    AND status = 'active'
    AND verification_status = 'approved';

  IF v_merchant.id IS NULL THEN
    RAISE EXCEPTION 'Merchant is not available for orders';
  END IF;

  SELECT * INTO v_store
  FROM public.stores
  WHERE merchant_id = v_merchant.id
    AND status = 'active';

  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Store is not available for orders';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF v_item ? 'sales_price'
       OR v_item ? 'wholesale_price'
       OR v_item ? 'merchant_profit' THEN
      RAISE EXCEPTION 'Order prices cannot be supplied by the client';
    END IF;

    v_listing_id := NULLIF(v_item ->> 'listing_id', '')::uuid;
    v_product_id := NULLIF(v_item ->> 'product_id', '')::uuid;
    v_variant_id := NULLIF(v_item ->> 'variant_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    IF v_variant_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Each item requires listing_id or product_id, variant_id, and a positive quantity';
    END IF;

    IF v_listing_id IS NOT NULL THEN
      SELECT * INTO v_listing
      FROM public.merchant_product_listings
      WHERE id = v_listing_id
        AND merchant_id = v_merchant.id
        AND status = 'active';
    ELSE
      SELECT * INTO v_listing
      FROM public.merchant_product_listings
      WHERE merchant_id = v_merchant.id
        AND product_id = v_product_id
        AND status = 'active';
    END IF;

    IF v_listing.id IS NULL THEN
      RAISE EXCEPTION 'Product is not listed by this merchant';
    END IF;

    IF v_product_id IS NOT NULL AND v_product_id IS DISTINCT FROM v_listing.product_id THEN
      RAISE EXCEPTION 'Product does not match the merchant listing';
    END IF;

    v_product_id := v_listing.product_id;
    v_listing_id := v_listing.id;

    SELECT * INTO v_variant
    FROM public.product_variants
    WHERE id = v_variant_id
      AND product_id = v_product_id
      AND is_active = true;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'Variant does not belong to the requested product';
    END IF;

    PERFORM set_config('app.inventory_reference', 'order-reserve', true);

    SELECT * INTO v_inventory
    FROM public.inventory
    WHERE variant_id = v_variant.id
    FOR UPDATE;

    IF v_inventory.id IS NULL
       OR v_inventory.availability IS NOT TRUE
       OR v_inventory.available_quantity < v_quantity THEN
      RAISE EXCEPTION 'Insufficient inventory for SKU %', v_variant.sku;
    END IF;

    UPDATE public.inventory
    SET reserved_quantity = reserved_quantity + v_quantity
    WHERE id = v_inventory.id;

    v_total := v_total + round(v_listing.sales_price * v_quantity, 2);
    v_prepared := v_prepared || jsonb_build_array(
      jsonb_build_object(
        'listing_id', v_listing.id,
        'product_id', v_product_id,
        'variant_id', v_variant.id,
        'quantity', v_quantity,
        'sales_price', v_listing.sales_price,
        'wholesale_price', v_listing.wholesale_price
      )
    );
  END LOOP;

  INSERT INTO public.orders (
    customer_id,
    merchant_id,
    store_id,
    status,
    total_amount,
    currency
  )
  VALUES (
    v_customer_id,
    v_merchant.id,
    v_store.id,
    'pending',
    v_total,
    'USD'
  )
  RETURNING * INTO v_order;

  INSERT INTO public.order_items (
    order_id,
    listing_id,
    product_id,
    variant_id,
    quantity,
    sales_price,
    wholesale_price
  )
  SELECT
    v_order.id,
    (elem ->> 'listing_id')::uuid,
    (elem ->> 'product_id')::uuid,
    (elem ->> 'variant_id')::uuid,
    (elem ->> 'quantity')::integer,
    (elem ->> 'sales_price')::numeric,
    (elem ->> 'wholesale_price')::numeric
  FROM jsonb_array_elements(v_prepared) AS elem;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_inventory_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IN ('pending', 'confirmed', 'awaiting_payment', 'paid', 'processing') THEN
    PERFORM set_config('app.inventory_reference', 'order:' || NEW.id::text, true);

    UPDATE public.inventory inv
    SET reserved_quantity = inv.reserved_quantity - oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = NEW.id
      AND inv.variant_id = oi.variant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_restore_inventory ON public.orders;
CREATE TRIGGER trg_orders_restore_inventory
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.status = 'cancelled'
    AND OLD.status IN ('pending', 'confirmed', 'awaiting_payment', 'paid', 'processing')
  )
  EXECUTE FUNCTION public.restore_inventory_on_cancel();

-- ---------------------------------------------------------------------------
-- Merchant confirm (wallet debit) / shipping / cancel / admin delivery
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_wholesale_due(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(round(sum(oi.wholesale_price * oi.quantity), 2), 0)
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;
$$;

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

CREATE OR REPLACE FUNCTION public.merchant_go_for_shipping(p_order_id uuid)
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

  IF v_order.status IN ('shipping', 'shipped', 'delivered', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'Order cannot be cancelled after shipping';
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

CREATE OR REPLACE FUNCTION public.release_order_profit(p_order_id uuid)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_sales numeric(18, 2);
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_privileged_role() THEN
    RAISE EXCEPTION 'Only admins can release order profit';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status <> 'delivered' THEN
    RAISE EXCEPTION 'Profit can only be released for delivered orders';
  END IF;

  v_sales := v_order.total_amount;

  IF v_sales IS NULL OR v_sales <= 0 THEN
    RAISE EXCEPTION 'No sales amount to release';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = v_order.merchant_id
    AND currency = v_order.currency
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Merchant wallet not found for order currency';
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
    'profit_release',
    v_sales,
    v_order.currency,
    'credit',
    'completed',
    'order',
    v_order.id,
    'Sales settlement for order ' || v_order.id::text
  )
  RETURNING * INTO v_tx;

  RETURN v_tx;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_confirm_delivery(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can confirm delivery';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status NOT IN ('shipping', 'shipped') THEN
    RAISE EXCEPTION 'Illegal order status transition';
  END IF;

  PERFORM set_config('app.inventory_reference', 'order-deliver:' || v_order.id::text, true);

  UPDATE public.inventory inv
  SET
    quantity = inv.quantity - oi.quantity,
    reserved_quantity = inv.reserved_quantity - oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND inv.variant_id = oi.variant_id;

  UPDATE public.orders
  SET status = 'delivered'
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  PERFORM public.release_order_profit(v_order.id);

  PERFORM public.log_admin_action(
    'confirm_delivery',
    'orders',
    v_order.id,
    'status=delivered'
  );

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- Store orders / admin search
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merchant_store_orders()
RETURNS TABLE (
  order_id uuid,
  store_id uuid,
  customer_id uuid,
  customer_name text,
  customer_email text,
  status public.order_status,
  total_amount numeric,
  currency public.supported_currency,
  created_at timestamptz,
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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.store_id,
    o.customer_id,
    p.full_name,
    p.email,
    o.status,
    o.total_amount,
    o.currency,
    o.created_at,
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
  JOIN public.profiles p ON p.user_id = o.customer_id
  WHERE o.merchant_id = public.current_merchant_id()
  ORDER BY o.created_at DESC, oi.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_orders(
  p_order_id uuid DEFAULT NULL,
  p_store_id uuid DEFAULT NULL,
  p_merchant_query text DEFAULT NULL,
  p_customer_query text DEFAULT NULL,
  p_status public.order_status DEFAULT NULL
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
  wholesale_due numeric,
  currency public.supported_currency,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search orders';
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
    public.order_wholesale_due(o.id),
    o.currency,
    o.created_at
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  LEFT JOIN public.stores s ON s.id = o.store_id
  JOIN public.profiles mp ON mp.user_id = m.user_id
  JOIN public.profiles cp ON cp.user_id = o.customer_id
  WHERE (p_order_id IS NULL OR o.id = p_order_id)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND (p_status IS NULL OR o.status = p_status)
    AND (
      p_merchant_query IS NULL
      OR btrim(p_merchant_query) = ''
      OR m.store_name ILIKE '%' || btrim(p_merchant_query) || '%'
      OR m.business_email ILIKE '%' || btrim(p_merchant_query) || '%'
      OR mp.full_name ILIKE '%' || btrim(p_merchant_query) || '%'
    )
    AND (
      p_customer_query IS NULL
      OR btrim(p_customer_query) = ''
      OR cp.full_name ILIKE '%' || btrim(p_customer_query) || '%'
      OR cp.email ILIKE '%' || btrim(p_customer_query) || '%'
    )
  ORDER BY o.created_at DESC;
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
  WHERE wt.reference_type = 'order'
    AND wt.reference_id = p_order_id
  ORDER BY wt.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.order_wholesale_due(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_merchant_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_go_for_shipping(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_confirm_delivery(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_store_orders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_orders(uuid, uuid, text, text, public.order_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_order_payments(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.confirm_merchant_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_go_for_shipping(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirm_delivery(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_store_orders() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_orders(uuid, uuid, text, text, public.order_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_order_payments(uuid) TO authenticated, service_role;
