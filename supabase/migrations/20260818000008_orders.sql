-- R&B MAISON — orders and order items

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES public.merchants (id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  status public.order_status NOT NULL DEFAULT 'pending',
  total_amount numeric(18, 2) NOT NULL,
  currency public.supported_currency NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_amount_chk CHECK (total_amount > 0)
);

CREATE INDEX idx_orders_customer_id ON public.orders (customer_id);
CREATE INDEX idx_orders_merchant_id ON public.orders (merchant_id);
CREATE INDEX idx_orders_store_id ON public.orders (store_id);
CREATE INDEX idx_orders_status ON public.orders (status);
CREATE INDEX idx_orders_created_at ON public.orders (created_at DESC);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants (id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  sales_price numeric(18, 2) NOT NULL,
  wholesale_price numeric(18, 2) NOT NULL,
  merchant_profit numeric(18, 2) GENERATED ALWAYS AS (
    round((sales_price - wholesale_price) * quantity::numeric, 2)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_quantity_chk CHECK (quantity > 0),
  CONSTRAINT order_items_sales_price_chk CHECK (sales_price > 0),
  CONSTRAINT order_items_wholesale_price_chk CHECK (
    wholesale_price > 0 AND wholesale_price <= sales_price
  )
);

CREATE INDEX idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX idx_order_items_product_id ON public.order_items (product_id);
CREATE INDEX idx_order_items_variant_id ON public.order_items (variant_id);

COMMENT ON TABLE public.orders IS
  'Customer purchases from a merchant store. Totals are derived from order_items at placement time.';

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
         AND OLD.status = 'pending'
         AND NEW.status = 'cancelled' THEN
        RETURN NEW;
      END IF;

      IF v_merchant_id IS NOT NULL
         AND OLD.merchant_id = v_merchant_id THEN
        IF (OLD.status = 'pending' AND NEW.status = 'confirmed')
           OR (OLD.status = 'confirmed' AND NEW.status IN ('paid', 'processing'))
           OR (OLD.status = 'paid' AND NEW.status = 'processing')
           OR (OLD.status = 'processing' AND NEW.status = 'shipped')
           OR (OLD.status = 'shipped' AND NEW.status = 'delivered') THEN
          RETURN NEW;
        END IF;
      END IF;

      RAISE EXCEPTION 'Illegal order status transition';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_protect
  BEFORE UPDATE OR DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_order_mutations();

CREATE TRIGGER trg_orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.protect_order_items_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Order items are immutable';
END;
$$;

CREATE TRIGGER trg_order_items_no_update
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_order_items_immutable();

CREATE TRIGGER trg_order_items_no_delete
  BEFORE DELETE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_order_items_immutable();

CREATE TRIGGER trg_orders_audit
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

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
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_variant_id := (v_item ->> 'variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    IF v_product_id IS NULL OR v_variant_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Each item requires product_id, variant_id, and a positive quantity';
    END IF;

    SELECT * INTO v_listing
    FROM public.merchant_product_listings
    WHERE merchant_id = v_merchant.id
      AND product_id = v_product_id
      AND status = 'active';

    IF v_listing.id IS NULL THEN
      RAISE EXCEPTION 'Product is not listed by this merchant';
    END IF;

    SELECT * INTO v_variant
    FROM public.product_variants
    WHERE id = v_variant_id
      AND product_id = v_product_id;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'Variant does not belong to the requested product';
    END IF;

    SELECT * INTO v_inventory
    FROM public.inventory
    WHERE variant_id = v_variant.id
    FOR UPDATE;

    IF v_inventory.id IS NULL
       OR v_inventory.availability IS NOT TRUE
       OR v_inventory.quantity < v_quantity THEN
      RAISE EXCEPTION 'Insufficient inventory for SKU %', v_variant.sku;
    END IF;

    UPDATE public.inventory
    SET quantity = quantity - v_quantity
    WHERE id = v_inventory.id;

    v_total := v_total + round(v_listing.sales_price * v_quantity, 2);
    v_prepared := v_prepared || jsonb_build_array(
      jsonb_build_object(
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
    product_id,
    variant_id,
    quantity,
    sales_price,
    wholesale_price
  )
  SELECT
    v_order.id,
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
  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    UPDATE public.inventory inv
    SET quantity = inv.quantity + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = NEW.id
      AND inv.variant_id = oi.variant_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_restore_inventory
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status = 'cancelled')
  EXECUTE FUNCTION public.restore_inventory_on_cancel();

CREATE OR REPLACE FUNCTION public.release_order_profit(p_order_id uuid)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_profit numeric(18, 2);
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

  SELECT coalesce(sum(merchant_profit), 0) INTO v_profit
  FROM public.order_items
  WHERE order_id = v_order.id;

  IF v_profit <= 0 THEN
    RAISE EXCEPTION 'No merchant profit to release';
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
    v_profit,
    v_order.currency,
    'credit',
    'completed',
    'order',
    v_order.id,
    'Profit release for order ' || v_order.id::text
  )
  RETURNING * INTO v_tx;

  RETURN v_tx;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_order_profit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_order_profit(uuid) TO authenticated, service_role;
