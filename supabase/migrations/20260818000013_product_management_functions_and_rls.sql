-- R&B MAISON — product management RPCs, views, and additive RLS

-- ---------------------------------------------------------------------------
-- Public-safe availability (no on-hand or reserved quantities)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.catalogue_availability
WITH (security_barrier = true) AS
SELECT
  v.id AS variant_id,
  v.product_id,
  (i.availability = true AND i.available_quantity > 0 AND v.is_active = true) AS in_stock
FROM public.product_variants v
JOIN public.inventory i ON i.variant_id = v.id
JOIN public.products p ON p.id = v.product_id
WHERE p.status = 'active'
  AND p.published = true
  AND v.is_active = true;

GRANT SELECT ON public.catalogue_availability TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: tighten public product visibility; do not drop unrelated policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS products_select_active ON public.products;
CREATE POLICY products_select_published
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (
    public.is_admin()
    OR (status = 'active' AND published = true)
  );

CREATE POLICY products_select_merchant_listed
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.merchant_product_listings mpl
      WHERE mpl.product_id = products.id
        AND mpl.merchant_id = public.current_merchant_id()
    )
  );

DROP POLICY IF EXISTS product_images_select ON public.product_images;
CREATE POLICY product_images_select_published
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
        AND p.published = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.merchant_product_listings mpl
      WHERE mpl.product_id = product_images.product_id
        AND mpl.merchant_id = public.current_merchant_id()
    )
  );

DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select_published
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
        AND p.published = true
        AND product_variants.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.merchant_product_listings mpl
      WHERE mpl.product_id = product_variants.product_id
        AND mpl.merchant_id = public.current_merchant_id()
    )
  );

DROP POLICY IF EXISTS inventory_select ON public.inventory;
CREATE POLICY inventory_select_admin
  ON public.inventory
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS brands_select ON public.brands;
CREATE POLICY brands_select_active
  ON public.brands
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active' OR public.is_admin());

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_transactions_select_admin
  ON public.inventory_transactions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Inserts are performed by log_inventory_change (SECURITY DEFINER).

-- ---------------------------------------------------------------------------
-- Admin inventory adjustment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_adjust_inventory(
  p_variant_id uuid,
  p_type public.inventory_transaction_type,
  p_quantity integer,
  p_reference text DEFAULT NULL
)
RETURNS public.inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.inventory;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_privileged_role() THEN
    RAISE EXCEPTION 'Only admins can adjust inventory';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_type NOT IN ('stock_added', 'stock_removed', 'adjustment') THEN
    RAISE EXCEPTION 'Admin inventory adjustments cannot use order reservation types';
  END IF;

  PERFORM set_config('app.inventory_reference', coalesce(p_reference, ''), true);

  SELECT * INTO v_row
  FROM public.inventory
  WHERE variant_id = p_variant_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Inventory row not found for variant';
  END IF;

  IF p_type = 'stock_added' THEN
    UPDATE public.inventory
    SET quantity = quantity + p_quantity,
        availability = true
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSIF p_type = 'stock_removed' THEN
    IF (v_row.quantity - v_row.reserved_quantity) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient available stock';
    END IF;
    UPDATE public.inventory
    SET quantity = quantity - p_quantity
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.inventory
    SET quantity = p_quantity
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_inventory(uuid, public.inventory_transaction_type, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory(uuid, public.inventory_transaction_type, integer, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Publish / unpublish / archive
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_product_publication(
  p_product_id uuid,
  p_published boolean
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.products;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can publish products';
  END IF;

  UPDATE public.products
  SET published = p_published,
      status = CASE
        WHEN p_published = true AND status = 'draft' THEN 'active'::public.product_status
        ELSE status
      END
  WHERE id = p_product_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_archive_product(p_product_id uuid)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.products;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can archive products';
  END IF;

  UPDATE public.products
  SET status = 'archived',
      published = false
  WHERE id = p_product_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_product_publication(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_archive_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_product_publication(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_archive_product(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Merchant listing (wholesale always server-side)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_merchant_listing(
  p_product_id uuid,
  p_sales_price numeric
)
RETURNS public.merchant_product_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_product public.products;
  v_row public.merchant_product_listings;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only merchants can create listings';
  END IF;

  IF public.is_admin() AND v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Admin listing creation must use the table with an explicit merchant_id';
  END IF;

  IF p_sales_price IS NULL OR p_sales_price <= 0 THEN
    RAISE EXCEPTION 'Sales price must be greater than zero';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND status = 'active'
    AND published = true;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product is not available for listing';
  END IF;

  INSERT INTO public.merchant_product_listings (
    merchant_id,
    product_id,
    sales_price,
    status
  )
  VALUES (
    v_merchant_id,
    p_product_id,
    p_sales_price,
    'pending'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_merchant_listing(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_merchant_listing(uuid, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public catalogue search (invoker so RLS still applies)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_catalogue(
  p_query text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_gender public.product_gender DEFAULT NULL,
  p_price_min numeric DEFAULT NULL,
  p_price_max numeric DEFAULT NULL,
  p_available_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  description text,
  brand_id uuid,
  brand_name text,
  category_id uuid,
  category_name text,
  gender public.product_gender,
  collection text,
  price numeric,
  currency public.supported_currency,
  in_stock boolean,
  primary_image_url text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE category_tree AS (
    SELECT c.id
    FROM public.product_categories c
    WHERE p_category_id IS NOT NULL
      AND c.id = p_category_id
    UNION ALL
    SELECT child.id
    FROM public.product_categories child
    JOIN category_tree parent ON child.parent_id = parent.id
  )
  SELECT
    p.id,
    p.name,
    p.slug,
    p.description,
    p.brand_id,
    b.name AS brand_name,
    p.category_id,
    cat.name AS category_name,
    p.gender,
    p.collection,
    p.price,
    p.currency,
    EXISTS (
      SELECT 1
      FROM public.catalogue_availability a
      WHERE a.product_id = p.id
        AND a.in_stock = true
    ) AS in_stock,
    (
      SELECT coalesce(img.image_url, img.storage_path)
      FROM public.product_images img
      WHERE img.product_id = p.id
      ORDER BY img.is_primary DESC, img.position ASC
      LIMIT 1
    ) AS primary_image_url
  FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.product_categories cat ON cat.id = p.category_id
  WHERE p.status = 'active'
    AND p.published = true
    AND (p_brand_id IS NULL OR p.brand_id = p_brand_id)
    AND (p_gender IS NULL OR p.gender = p_gender)
    AND (p_price_min IS NULL OR p.price >= p_price_min)
    AND (p_price_max IS NULL OR p.price <= p_price_max)
    AND (
      p_category_id IS NULL
      OR p.category_id IN (SELECT category_tree.id FROM category_tree)
    )
    AND (
      p_query IS NULL
      OR btrim(p_query) = ''
      OR p.name ILIKE '%' || btrim(p_query) || '%'
      OR p.slug ILIKE '%' || btrim(p_query) || '%'
      OR b.name ILIKE '%' || btrim(p_query) || '%'
      OR cat.name ILIKE '%' || btrim(p_query) || '%'
      OR EXISTS (
        SELECT 1
        FROM public.product_variants v
        WHERE v.product_id = p.id
          AND v.sku ILIKE '%' || btrim(p_query) || '%'
      )
    )
    AND (
      p_available_only IS NOT TRUE
      OR EXISTS (
        SELECT 1
        FROM public.catalogue_availability a
        WHERE a.product_id = p.id
          AND a.in_stock = true
      )
    )
  ORDER BY p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.search_catalogue(text, uuid, uuid, public.product_gender, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalogue(text, uuid, uuid, public.product_gender, numeric, numeric, boolean) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Merchant listed-product projection (includes wholesale for the owner)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merchant_listed_products()
RETURNS TABLE (
  listing_id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  primary_image_url text,
  sales_price numeric,
  wholesale_price numeric,
  listing_status public.listing_status,
  listed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    mpl.id,
    p.id,
    p.name,
    p.slug,
    (
      SELECT coalesce(img.image_url, img.storage_path)
      FROM public.product_images img
      WHERE img.product_id = p.id
      ORDER BY img.is_primary DESC, img.position ASC
      LIMIT 1
    ),
    mpl.sales_price,
    mpl.wholesale_price,
    mpl.status,
    mpl.created_at
  FROM public.merchant_product_listings mpl
  JOIN public.products p ON p.id = mpl.product_id
  WHERE mpl.merchant_id = public.current_merchant_id()
     OR public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.merchant_listed_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merchant_listed_products() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Orders: reserve available stock instead of decrementing on-hand quantity
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
