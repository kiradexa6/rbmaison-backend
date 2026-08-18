-- R&B MAISON — production hardening
-- Closes remaining privilege gaps without replacing existing systems.

-- ---------------------------------------------------------------------------
-- Orders: cannot mark paid without a completed wholesale ledger debit
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

-- ---------------------------------------------------------------------------
-- Listings: client inserts cannot set a custom sales price
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_listing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
  v_merchant_id uuid;
  v_relist boolean;
  v_price numeric(18, 2);
  v_published boolean;
  v_product_status public.product_status;
BEGIN
  v_admin := public.is_admin();
  v_merchant_id := public.current_merchant_id();
  v_relist := TG_OP = 'UPDATE'
    AND OLD.status = 'removed'
    AND NEW.status = 'active'
    AND OLD.merchant_id IS NOT DISTINCT FROM v_merchant_id;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_admin AND NEW.merchant_id IS DISTINCT FROM v_merchant_id THEN
      RAISE EXCEPTION 'Merchants can only create listings for their own account';
    END IF;

    IF NOT v_admin THEN
      SELECT p.price, p.published, p.status
      INTO v_price, v_published, v_product_status
      FROM public.products p
      WHERE p.id = NEW.product_id;

      IF v_price IS NULL OR v_published IS NOT TRUE OR v_product_status <> 'active' THEN
        RAISE EXCEPTION 'Product is not available for listing';
      END IF;

      NEW.sales_price := v_price;
      NEW.status := 'active';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'listing merchant_id cannot be changed';
  END IF;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'listing product_id cannot be changed';
  END IF;

  IF NEW.sales_price IS DISTINCT FROM OLD.sales_price AND NOT v_admin AND NOT v_relist THEN
    RAISE EXCEPTION 'Sales price snapshot cannot be changed';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND NOT v_admin AND NOT v_relist THEN
    RAISE EXCEPTION 'listing created_at cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_admin THEN
    IF NOT (
      OLD.status IN ('pending', 'active', 'inactive', 'suspended')
      AND NEW.status = 'removed'
      AND OLD.merchant_id IS NOT DISTINCT FROM v_merchant_id
    ) THEN
      RAISE EXCEPTION 'Merchants can only remove their own listings';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Explicit write revokes: financial, order, listing, and notification tables
-- Client writes go through SECURITY DEFINER RPCs only.
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_deposit_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.withdrawal_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.merchant_product_listings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.merchant_applications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.merchant_credit_scores FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_activity_logs FROM anon, authenticated;

GRANT SELECT ON public.wallets TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT SELECT ON public.wallet_deposit_requests TO authenticated;
GRANT SELECT ON public.withdrawal_requests TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.merchant_product_listings TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.merchant_applications TO authenticated;
GRANT SELECT ON public.merchant_credit_scores TO authenticated;
GRANT SELECT ON public.admin_activity_logs TO authenticated;

COMMENT ON FUNCTION public.protect_order_mutations() IS
  'Blocks paid status without a completed order_payment ledger row. Delivery remains admin-only.';
