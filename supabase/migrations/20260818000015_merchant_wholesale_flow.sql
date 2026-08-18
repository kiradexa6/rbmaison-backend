-- R&B MAISON — merchant store + wholesale listing flow
-- Merchants sell platform products through merchant_product_listings.
-- Wholesale price is always sales_price × 0.80 and is never taken from the client.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS wholesale_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.merchants.wholesale_enabled IS
  'Admin-controlled wholesale access. Merchants cannot change this flag.';

ALTER TABLE public.merchant_product_listings
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE public.merchant_product_listings
  ADD COLUMN IF NOT EXISTS sales_price_snapshot numeric(18, 2)
  GENERATED ALWAYS AS (sales_price) STORED;

COMMENT ON COLUMN public.merchant_product_listings.sales_price_snapshot IS
  'Immutable snapshot alias of sales_price taken from the catalogue at list time.';

ALTER TABLE public.merchant_product_listings
  DROP CONSTRAINT IF EXISTS merchant_product_listings_merchant_product_uq;

CREATE UNIQUE INDEX IF NOT EXISTS merchant_product_listings_live_product_uq
  ON public.merchant_product_listings (merchant_id, product_id)
  WHERE status <> 'removed';

-- ---------------------------------------------------------------------------
-- Protect merchant wholesale_enabled (admin only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_merchant_security_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
BEGIN
  v_admin := public.is_admin();

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'merchants.user_id cannot be changed';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'merchants.id cannot be changed';
  END IF;

  IF NEW.store_id IS DISTINCT FROM OLD.store_id AND NOT v_admin THEN
    IF OLD.store_id IS NOT NULL THEN
      RAISE EXCEPTION 'store_id cannot be reassigned';
    END IF;
  END IF;

  IF (NEW.verification_status IS DISTINCT FROM OLD.verification_status
      OR NEW.status IS DISTINCT FROM OLD.status)
     AND NOT v_admin THEN
    RAISE EXCEPTION 'Merchant verification and status can only be changed by an admin';
  END IF;

  IF NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled AND NOT v_admin THEN
    RAISE EXCEPTION 'Wholesale access can only be changed by an admin';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Protect listing columns
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
-- Replace listing RPCs (drop old signatures first)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_merchant_listing(uuid, numeric);
DROP FUNCTION IF EXISTS public.merchant_listed_products();

CREATE OR REPLACE FUNCTION public.preview_merchant_listing(p_product_id uuid)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  brand_name text,
  category_name text,
  primary_image_url text,
  sales_price numeric,
  wholesale_price numeric,
  discount_percentage numeric,
  listed boolean,
  listing_id uuid,
  listing_status public.listing_status
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_exists boolean;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can preview wholesale listings';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.status = 'active'
      AND p.published = true
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Product is not available for listing';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    b.name,
    cat.name,
    (
      SELECT coalesce(img.image_url, img.storage_path)
      FROM public.product_images img
      WHERE img.product_id = p.id
      ORDER BY img.is_primary DESC, img.position ASC
      LIMIT 1
    ),
    p.price,
    round(p.price * 0.80::numeric, 2),
    20::numeric,
    (mpl.id IS NOT NULL),
    mpl.id,
    mpl.status
  FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.product_categories cat ON cat.id = p.category_id
  LEFT JOIN public.merchant_product_listings mpl
    ON mpl.product_id = p.id
   AND mpl.merchant_id = v_merchant_id
   AND mpl.status <> 'removed'
  WHERE p.id = p_product_id
    AND p.status = 'active'
    AND p.published = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_merchant_listing(p_product_id uuid)
RETURNS public.merchant_product_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_merchant public.merchants;
  v_product public.products;
  v_existing public.merchant_product_listings;
  v_row public.merchant_product_listings;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can create listings';
  END IF;

  SELECT * INTO v_merchant
  FROM public.merchants
  WHERE id = v_merchant_id;

  IF v_merchant.id IS NULL THEN
    RAISE EXCEPTION 'Merchant account not found';
  END IF;

  IF v_merchant.wholesale_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Wholesale access is suspended for this merchant';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND status = 'active'
    AND published = true;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product is not available for listing';
  END IF;

  SELECT * INTO v_existing
  FROM public.merchant_product_listings
  WHERE merchant_id = v_merchant_id
    AND product_id = p_product_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL AND v_existing.status <> 'removed' THEN
    RAISE EXCEPTION 'Product is already listed';
  END IF;

  IF v_existing.id IS NOT NULL AND v_existing.status = 'removed' THEN
    UPDATE public.merchant_product_listings
    SET
      sales_price = v_product.price,
      discount_percentage = 20,
      status = 'active',
      created_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  INSERT INTO public.merchant_product_listings (
    merchant_id,
    product_id,
    sales_price,
    discount_percentage,
    status
  )
  VALUES (
    v_merchant_id,
    p_product_id,
    v_product.price,
    20,
    'active'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_merchant_listing(p_listing_id uuid)
RETURNS public.merchant_product_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_row public.merchant_product_listings;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can remove listings';
  END IF;

  UPDATE public.merchant_product_listings
  SET status = 'removed'
  WHERE id = p_listing_id
    AND merchant_id = v_merchant_id
    AND status <> 'removed'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.merchant_wholesale_catalog(
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
  primary_image_url text,
  sales_price numeric,
  wholesale_price numeric,
  listed boolean,
  listing_id uuid,
  listing_status public.listing_status
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF public.current_merchant_id() IS NULL THEN
    RAISE EXCEPTION 'Only merchants can open wholesale management';
  END IF;

  RETURN QUERY
  SELECT
    sc.id,
    sc.name,
    sc.slug,
    sc.description,
    sc.brand_id,
    sc.brand_name,
    sc.category_id,
    sc.category_name,
    sc.gender,
    sc.collection,
    sc.price,
    sc.currency,
    sc.in_stock,
    sc.primary_image_url,
    sc.price,
    round(sc.price * 0.80::numeric, 2),
    (mpl.id IS NOT NULL),
    mpl.id,
    mpl.status
  FROM public.search_catalogue(
    p_query,
    p_brand_id,
    p_category_id,
    p_gender,
    p_price_min,
    p_price_max,
    p_available_only
  ) sc
  LEFT JOIN public.merchant_product_listings mpl
    ON mpl.product_id = sc.id
   AND mpl.merchant_id = public.current_merchant_id()
   AND mpl.status <> 'removed'
  ORDER BY sc.name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.merchant_listed_products()
RETURNS TABLE (
  listing_id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  brand_name text,
  category_name text,
  primary_image_url text,
  sales_price numeric,
  sales_price_snapshot numeric,
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
    b.name,
    cat.name,
    (
      SELECT coalesce(img.image_url, img.storage_path)
      FROM public.product_images img
      WHERE img.product_id = p.id
      ORDER BY img.is_primary DESC, img.position ASC
      LIMIT 1
    ),
    mpl.sales_price,
    mpl.sales_price_snapshot,
    mpl.wholesale_price,
    mpl.status,
    mpl.created_at
  FROM public.merchant_product_listings mpl
  JOIN public.products p ON p.id = mpl.product_id
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.product_categories cat ON cat.id = p.category_id
  WHERE mpl.merchant_id = public.current_merchant_id()
    AND mpl.status <> 'removed';
$$;

CREATE OR REPLACE FUNCTION public.merchant_store_profile()
RETURNS TABLE (
  merchant_id uuid,
  store_id uuid,
  store_name text,
  owner_name text,
  owner_email text,
  owner_phone text,
  verification_status public.verification_status,
  account_status public.merchant_status,
  wholesale_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.store_id,
    m.store_name,
    p.full_name,
    p.email,
    COALESCE(m.phone, p.phone),
    m.verification_status,
    m.status,
    m.wholesale_enabled
  FROM public.merchants m
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Admin wholesale / merchant control
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_search_merchants(
  p_store_id uuid DEFAULT NULL,
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  merchant_id uuid,
  store_id uuid,
  store_name text,
  owner_name text,
  owner_email text,
  owner_phone text,
  verification_status public.verification_status,
  account_status public.merchant_status,
  wholesale_enabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search merchants';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.store_id,
    m.store_name,
    p.full_name,
    p.email,
    COALESCE(m.phone, p.phone),
    m.verification_status,
    m.status,
    m.wholesale_enabled
  FROM public.merchants m
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE (p_store_id IS NULL OR m.store_id = p_store_id)
    AND (
      p_query IS NULL
      OR btrim(p_query) = ''
      OR m.store_name ILIKE '%' || btrim(p_query) || '%'
      OR m.business_email ILIKE '%' || btrim(p_query) || '%'
      OR p.full_name ILIKE '%' || btrim(p_query) || '%'
      OR p.email ILIKE '%' || btrim(p_query) || '%'
    )
  ORDER BY m.store_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_listings(
  p_store_id uuid DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_merchant_query text DEFAULT NULL,
  p_product_query text DEFAULT NULL,
  p_status public.listing_status DEFAULT NULL
)
RETURNS TABLE (
  listing_id uuid,
  merchant_id uuid,
  store_id uuid,
  store_name text,
  merchant_name text,
  product_id uuid,
  product_name text,
  sales_price numeric,
  wholesale_price numeric,
  listing_status public.listing_status,
  listed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search listings';
  END IF;

  RETURN QUERY
  SELECT
    mpl.id,
    m.id,
    m.store_id,
    COALESCE(s.store_name, m.store_name),
    COALESCE(p.full_name, m.store_name),
    pr.id,
    pr.name,
    mpl.sales_price,
    mpl.wholesale_price,
    mpl.status,
    mpl.created_at
  FROM public.merchant_product_listings mpl
  JOIN public.merchants m ON m.id = mpl.merchant_id
  LEFT JOIN public.stores s ON s.id = m.store_id
  JOIN public.profiles p ON p.user_id = m.user_id
  JOIN public.products pr ON pr.id = mpl.product_id
  WHERE (p_store_id IS NULL OR m.store_id = p_store_id)
    AND (p_merchant_id IS NULL OR m.id = p_merchant_id)
    AND (p_status IS NULL OR mpl.status = p_status)
    AND (
      p_merchant_query IS NULL
      OR btrim(p_merchant_query) = ''
      OR m.store_name ILIKE '%' || btrim(p_merchant_query) || '%'
      OR m.business_email ILIKE '%' || btrim(p_merchant_query) || '%'
      OR p.full_name ILIKE '%' || btrim(p_merchant_query) || '%'
      OR p.email ILIKE '%' || btrim(p_merchant_query) || '%'
    )
    AND (
      p_product_query IS NULL
      OR btrim(p_product_query) = ''
      OR pr.name ILIKE '%' || btrim(p_product_query) || '%'
      OR pr.slug ILIKE '%' || btrim(p_product_query) || '%'
    )
  ORDER BY mpl.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_listing_status(
  p_listing_id uuid,
  p_status public.listing_status
)
RETURNS public.merchant_product_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.merchant_product_listings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change listing status';
  END IF;

  IF p_status NOT IN ('active', 'inactive', 'removed', 'suspended') THEN
    RAISE EXCEPTION 'Invalid listing status';
  END IF;

  UPDATE public.merchant_product_listings
  SET status = p_status
  WHERE id = p_listing_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  PERFORM public.log_admin_action(
    CASE p_status
      WHEN 'inactive' THEN 'disable_listing'
      WHEN 'removed' THEN 'remove_listing'
      ELSE 'set_listing_status'
    END,
    'merchant_product_listings',
    v_row.id,
    'status=' || p_status::text
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_merchant_wholesale_access(
  p_merchant_id uuid,
  p_enabled boolean
)
RETURNS public.merchants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.merchants;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change wholesale access';
  END IF;

  UPDATE public.merchants
  SET wholesale_enabled = COALESCE(p_enabled, false)
  WHERE id = p_merchant_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Merchant not found';
  END IF;

  PERFORM public.log_admin_action(
    CASE WHEN v_row.wholesale_enabled THEN 'enable_wholesale_access' ELSE 'suspend_wholesale_access' END,
    'merchants',
    v_row.id,
    'wholesale_enabled=' || v_row.wholesale_enabled::text
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_merchant_listing(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_merchant_listing(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_merchant_listing(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_wholesale_catalog(text, uuid, uuid, public.product_gender, numeric, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_listed_products() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_store_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_merchants(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_listings(uuid, uuid, text, text, public.listing_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_listing_status(uuid, public.listing_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_merchant_wholesale_access(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.preview_merchant_listing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_merchant_listing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_merchant_listing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_wholesale_catalog(text, uuid, uuid, public.product_gender, numeric, numeric, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_listed_products() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_store_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_merchants(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_listings(uuid, uuid, text, text, public.listing_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_listing_status(uuid, public.listing_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_merchant_wholesale_access(uuid, boolean) TO authenticated, service_role;
