-- R&B MAISON — Row Level Security
-- Frontend checks are never sufficient. Every table is locked down here.

CREATE OR REPLACE FUNCTION public.can_read_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = p_order_id
      AND (
        public.is_admin()
        OR o.customer_id = auth.uid()
        OR o.merchant_id = public.current_merchant_id()
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_order(uuid) TO anon, authenticated, service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_invitation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_product_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

CREATE POLICY profiles_select_own_or_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Inserts are performed by handle_new_user (SECURITY DEFINER). No client inserts.

-- ---------------------------------------------------------------------------
-- admin_activity_logs — immutable; admin read; writes via log_admin_action / triggers
-- ---------------------------------------------------------------------------

CREATE POLICY admin_activity_logs_select_admin
  ON public.admin_activity_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY admin_activity_logs_insert_admin
  ON public.admin_activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND admin_id = auth.uid());

-- ---------------------------------------------------------------------------
-- merchant_invitation_codes — admin only
-- ---------------------------------------------------------------------------

CREATE POLICY invitation_codes_admin_select
  ON public.merchant_invitation_codes
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY invitation_codes_admin_insert
  ON public.merchant_invitation_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND created_by = auth.uid());

CREATE POLICY invitation_codes_admin_update
  ON public.merchant_invitation_codes
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------------

CREATE POLICY merchants_select_own_or_admin
  ON public.merchants
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY merchants_update_own_or_admin
  ON public.merchants
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Inserts via register_merchant_with_invitation (SECURITY DEFINER).

-- ---------------------------------------------------------------------------
-- stores
-- Customers may view active storefronts. Merchants see their own store. Admins see all.
-- ---------------------------------------------------------------------------

CREATE POLICY stores_select_active_public
  ON public.stores
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active' OR public.is_admin() OR merchant_id = public.current_merchant_id());

CREATE POLICY stores_update_own_or_admin
  ON public.stores
  FOR UPDATE
  TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.is_admin())
  WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin());

-- ---------------------------------------------------------------------------
-- wallets / ledger
-- ---------------------------------------------------------------------------

CREATE POLICY wallets_select_own_or_admin
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.is_admin());

CREATE POLICY wallet_transactions_select_own_or_admin
  ON public.wallet_transactions
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.wallets w
      WHERE w.id = wallet_transactions.wallet_id
        AND w.merchant_id = public.current_merchant_id()
    )
  );

-- Wallet inserts/updates happen only through SECURITY DEFINER ledger functions.

CREATE POLICY wallet_transactions_admin_update
  ON public.wallet_transactions
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- catalogue — public read of active products; admin manages
-- ---------------------------------------------------------------------------

CREATE POLICY product_categories_select
  ON public.product_categories
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY product_categories_admin_write
  ON public.product_categories
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY brands_select
  ON public.brands
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY brands_admin_write
  ON public.brands
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY products_select_active
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active' OR public.is_admin());

CREATE POLICY products_admin_write
  ON public.products
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY product_images_select
  ON public.product_images
  FOR SELECT
  TO anon, authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = product_images.product_id
        AND p.status = 'active'
    )
  );

CREATE POLICY product_images_admin_write
  ON public.product_images
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY product_variants_select
  ON public.product_variants
  FOR SELECT
  TO anon, authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = product_variants.product_id
        AND p.status = 'active'
    )
  );

CREATE POLICY product_variants_admin_write
  ON public.product_variants
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY inventory_select
  ON public.inventory
  FOR SELECT
  TO anon, authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = inventory.variant_id
        AND p.status = 'active'
    )
  );

CREATE POLICY inventory_admin_write
  ON public.inventory
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- merchant listings
-- ---------------------------------------------------------------------------

CREATE POLICY listings_select
  ON public.merchant_product_listings
  FOR SELECT
  TO authenticated
  USING (
    merchant_id = public.current_merchant_id()
    OR public.is_admin()
  );

CREATE POLICY listings_insert_own
  ON public.merchant_product_listings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR merchant_id = public.current_merchant_id()
  );

CREATE POLICY listings_update_own_or_admin
  ON public.merchant_product_listings
  FOR UPDATE
  TO authenticated
  USING (
    merchant_id = public.current_merchant_id()
    OR public.is_admin()
  )
  WITH CHECK (
    merchant_id = public.current_merchant_id()
    OR public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- orders
-- Customers see their own. Merchants see their store's orders. Admins see all.
-- ---------------------------------------------------------------------------

CREATE POLICY orders_select_scoped
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR customer_id = auth.uid()
    OR merchant_id = public.current_merchant_id()
  );

CREATE POLICY orders_update_scoped
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR customer_id = auth.uid()
    OR merchant_id = public.current_merchant_id()
  )
  WITH CHECK (
    public.is_admin()
    OR customer_id = auth.uid()
    OR merchant_id = public.current_merchant_id()
  );

CREATE POLICY order_items_select_merchant_or_admin
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.merchant_id = public.current_merchant_id()
    )
  );

-- Order and item inserts are performed by place_order (SECURITY DEFINER).

-- Public storefront projection: active listings without wholesale_price.
CREATE VIEW public.storefront_listings
WITH (security_barrier = true) AS
SELECT
  mpl.id,
  mpl.merchant_id,
  mpl.product_id,
  mpl.sales_price,
  mpl.status,
  mpl.created_at,
  mpl.updated_at
FROM public.merchant_product_listings mpl
WHERE mpl.status = 'active';

-- Customer line items without wholesale_price or merchant_profit.
CREATE VIEW public.customer_order_items
WITH (security_barrier = true) AS
SELECT
  oi.id,
  oi.order_id,
  oi.product_id,
  oi.variant_id,
  oi.quantity,
  oi.sales_price,
  oi.created_at
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
WHERE o.customer_id = auth.uid();

GRANT SELECT ON public.storefront_listings TO anon, authenticated, service_role;
GRANT SELECT ON public.customer_order_items TO authenticated, service_role;

CREATE TRIGGER trg_profiles_audit
  AFTER UPDATE OF role, status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();
