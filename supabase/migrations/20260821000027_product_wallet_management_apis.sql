-- Product detail and wallet transaction search RPCs for production APIs.

CREATE OR REPLACE FUNCTION public.merchant_listing_detail(p_listing_id uuid)
RETURNS TABLE (
  listing_id uuid,
  listing_status public.listing_status,
  listed_at timestamptz,
  product_id uuid,
  product_name text,
  product_slug text,
  product_description text,
  brand_id uuid,
  brand_name text,
  category_id uuid,
  category_name text,
  gender public.product_gender,
  collection text,
  sales_price numeric,
  sales_price_snapshot numeric,
  wholesale_price numeric,
  discount_percentage numeric,
  catalogue_price numeric,
  currency public.supported_currency,
  in_stock boolean,
  primary_image_url text,
  images jsonb,
  variants jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  v_merchant_id := public.current_merchant_id();
  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can view listing details';
  END IF;

  RETURN QUERY
  SELECT
    mpl.id,
    mpl.status,
    mpl.created_at,
    p.id,
    p.name,
    p.slug,
    p.description,
    b.id,
    b.name,
    cat.id,
    cat.name,
    p.gender,
    p.collection,
    mpl.sales_price,
    mpl.sales_price_snapshot,
    mpl.wholesale_price,
    mpl.discount_percentage,
    p.price,
    p.currency,
    coalesce(av.in_stock, false),
    (
      SELECT coalesce(img.image_url, img.storage_path)
      FROM public.product_images img
      WHERE img.product_id = p.id
      ORDER BY img.is_primary DESC, img.position ASC
      LIMIT 1
    ),
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', img.id,
            'storagePath', img.storage_path,
            'imageUrl', img.image_url,
            'altText', img.alt_text,
            'position', img.position,
            'isPrimary', img.is_primary
          )
          ORDER BY img.is_primary DESC, img.position ASC
        )
        FROM public.product_images img
        WHERE img.product_id = p.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pv.id,
            'sku', pv.sku,
            'size', pv.size,
            'color', pv.color,
            'priceOverride', pv.price_override,
            'isActive', pv.is_active,
            'inStock', coalesce(inv.available_quantity, 0) > 0
          )
          ORDER BY pv.sku ASC
        )
        FROM public.product_variants pv
        LEFT JOIN public.inventory inv ON inv.variant_id = pv.id
        WHERE pv.product_id = p.id
          AND pv.is_active = true
      ),
      '[]'::jsonb
    )
  FROM public.merchant_product_listings mpl
  JOIN public.products p ON p.id = mpl.product_id
  JOIN public.brands b ON b.id = p.brand_id
  JOIN public.product_categories cat ON cat.id = p.category_id
  LEFT JOIN public.catalogue_availability av ON av.product_id = p.id
  WHERE mpl.id = p_listing_id
    AND mpl.merchant_id = v_merchant_id
    AND mpl.status <> 'removed';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_wallet_transactions(
  p_store_id uuid DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_merchant_query text DEFAULT NULL,
  p_currency public.supported_currency DEFAULT NULL,
  p_type public.wallet_transaction_type DEFAULT NULL,
  p_status public.wallet_transaction_status DEFAULT NULL
)
RETURNS TABLE (
  transaction_id uuid,
  wallet_id uuid,
  merchant_id uuid,
  store_id uuid,
  store_name text,
  merchant_name text,
  type public.wallet_transaction_type,
  amount numeric,
  currency public.supported_currency,
  direction public.wallet_transaction_direction,
  status public.wallet_transaction_status,
  reference_type text,
  reference_id uuid,
  description text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search wallet transactions';
  END IF;

  RETURN QUERY
  SELECT
    wt.id,
    wt.wallet_id,
    w.merchant_id,
    m.store_id,
    coalesce(s.store_name, m.store_name),
    coalesce(p.full_name, m.store_name),
    wt.type,
    wt.amount,
    wt.currency,
    wt.direction,
    wt.status,
    wt.reference_type,
    wt.reference_id,
    wt.description,
    wt.created_at
  FROM public.wallet_transactions wt
  JOIN public.wallets w ON w.id = wt.wallet_id
  JOIN public.merchants m ON m.id = w.merchant_id
  LEFT JOIN public.stores s ON s.id = m.store_id
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE (p_store_id IS NULL OR m.store_id = p_store_id)
    AND (p_merchant_id IS NULL OR m.id = p_merchant_id)
    AND (p_currency IS NULL OR wt.currency = p_currency)
    AND (p_type IS NULL OR wt.type = p_type)
    AND (p_status IS NULL OR wt.status = p_status)
    AND (
      p_merchant_query IS NULL
      OR btrim(p_merchant_query) = ''
      OR m.store_name ILIKE '%' || btrim(p_merchant_query) || '%'
      OR p.full_name ILIKE '%' || btrim(p_merchant_query) || '%'
    )
  ORDER BY wt.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_listing_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_wallet_transactions(uuid, uuid, text, public.supported_currency, public.wallet_transaction_type, public.wallet_transaction_status) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.merchant_listing_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_wallet_transactions(uuid, uuid, text, public.supported_currency, public.wallet_transaction_type, public.wallet_transaction_status)
  TO authenticated, service_role;
