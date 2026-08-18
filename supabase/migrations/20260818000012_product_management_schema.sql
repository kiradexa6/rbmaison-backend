-- R&B MAISON — product management schema extensions
-- Additive only: existing catalogue tables are altered, not replaced.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    trim(both '-' FROM regexp_replace(lower(btrim(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.slugify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slugify(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS gender public.product_gender NOT NULL DEFAULT 'unisex',
  ADD COLUMN IF NOT EXISTS collection text,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

UPDATE public.products
SET slug = coalesce(public.slugify(name), 'product') || '-' || substr(id::text, 1, 8)
WHERE slug IS NULL;

ALTER TABLE public.products
  ALTER COLUMN slug SET NOT NULL;

ALTER TABLE public.products
  ADD CONSTRAINT products_slug_chk CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_slug ON public.products (slug);
CREATE INDEX IF NOT EXISTS idx_products_gender ON public.products (gender);
CREATE INDEX IF NOT EXISTS idx_products_published_status ON public.products (published, status);
CREATE INDEX IF NOT EXISTS idx_products_price ON public.products (price);
CREATE INDEX IF NOT EXISTS idx_products_collection ON public.products (collection);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON public.products
  USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_slug_trgm
  ON public.products
  USING gin (slug extensions.gin_trgm_ops);

COMMENT ON COLUMN public.products.published IS
  'Storefront visibility. Public catalogue requires status = active AND published = true.';

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS logo text,
  ADD COLUMN IF NOT EXISTS status public.brand_status NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_brands_status ON public.brands (status);
CREATE INDEX IF NOT EXISTS idx_brands_name_trgm
  ON public.brands
  USING gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- product_images: keep storage_path/sort_order; add public image fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS position integer,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

UPDATE public.product_images
SET position = sort_order
WHERE position IS NULL;

ALTER TABLE public.product_images
  ALTER COLUMN position SET DEFAULT 0;

UPDATE public.product_images
SET position = 0
WHERE position IS NULL;

ALTER TABLE public.product_images
  ALTER COLUMN position SET NOT NULL;

ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_position_chk CHECK (position >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_one_primary
  ON public.product_images (product_id)
  WHERE is_primary = true;

CREATE OR REPLACE FUNCTION public.sync_product_image_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.position IS NULL THEN
    NEW.position := COALESCE(NEW.sort_order, 0);
  END IF;
  NEW.sort_order := NEW.position;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_images_sync_order ON public.product_images;
CREATE TRIGGER trg_product_images_sync_order
  BEFORE INSERT OR UPDATE OF position, sort_order ON public.product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_image_order();

CREATE OR REPLACE FUNCTION public.ensure_single_primary_image()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.product_images
    SET is_primary = false
    WHERE product_id = NEW.product_id
      AND id IS DISTINCT FROM NEW.id
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_images_single_primary ON public.product_images;
CREATE TRIGGER trg_product_images_single_primary
  BEFORE INSERT OR UPDATE OF is_primary ON public.product_images
  FOR EACH ROW
  WHEN (NEW.is_primary = true)
  EXECUTE FUNCTION public.ensure_single_primary_image();

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS price_override numeric(18, 2),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_price_override_chk;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_price_override_chk CHECK (
    price_override IS NULL OR price_override > 0
  );

CREATE INDEX IF NOT EXISTS idx_product_variants_is_active ON public.product_variants (is_active);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku_trgm
  ON public.product_variants
  USING gin (sku extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- inventory: reserved + generated available
-- ---------------------------------------------------------------------------

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS reserved_quantity integer NOT NULL DEFAULT 0;

ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS inventory_reserved_chk;

ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_reserved_chk CHECK (
    reserved_quantity >= 0 AND reserved_quantity <= quantity
  );

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS available_quantity integer
  GENERATED ALWAYS AS (quantity - reserved_quantity) STORED;

CREATE INDEX IF NOT EXISTS idx_inventory_available_quantity
  ON public.inventory (available_quantity);

CREATE OR REPLACE FUNCTION public.sync_inventory_availability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quantity < 0 OR NEW.reserved_quantity < 0 THEN
    RAISE EXCEPTION 'Inventory quantities cannot be negative';
  END IF;

  IF NEW.reserved_quantity > NEW.quantity THEN
    RAISE EXCEPTION 'Reserved quantity cannot exceed on-hand quantity';
  END IF;

  IF (NEW.quantity - NEW.reserved_quantity) <= 0 THEN
    NEW.availability := false;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- inventory_transactions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants (id) ON DELETE RESTRICT,
  type public.inventory_transaction_type NOT NULL,
  quantity integer NOT NULL,
  reference text,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transactions_quantity_chk CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_variant_id
  ON public.inventory_transactions (variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_id
  ON public.inventory_transactions (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_type
  ON public.inventory_transactions (type);

COMMENT ON TABLE public.inventory_transactions IS
  'Append-only inventory ledger. Quantity/reserved changes on inventory always insert a row.';

CREATE OR REPLACE FUNCTION public.protect_inventory_transactions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Inventory transactions cannot be modified or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_transactions_no_update ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_transactions_no_update
  BEFORE UPDATE ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_inventory_transactions_immutable();

DROP TRIGGER IF EXISTS trg_inventory_transactions_no_delete ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_transactions_no_delete
  BEFORE DELETE ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_inventory_transactions_immutable();

CREATE OR REPLACE FUNCTION public.log_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.inventory_transaction_type;
  v_qty integer;
  v_product_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity = 0 AND NEW.reserved_quantity = 0 THEN
      RETURN NEW;
    END IF;
    v_type := 'stock_added';
    v_qty := GREATEST(NEW.quantity, 1);
  ELSE
    IF NEW.quantity IS NOT DISTINCT FROM OLD.quantity
       AND NEW.reserved_quantity IS NOT DISTINCT FROM OLD.reserved_quantity THEN
      RETURN NEW;
    END IF;

    IF NEW.quantity > OLD.quantity AND NEW.reserved_quantity IS NOT DISTINCT FROM OLD.reserved_quantity THEN
      v_type := 'stock_added';
      v_qty := NEW.quantity - OLD.quantity;
    ELSIF NEW.quantity < OLD.quantity AND NEW.reserved_quantity IS NOT DISTINCT FROM OLD.reserved_quantity THEN
      v_type := 'stock_removed';
      v_qty := OLD.quantity - NEW.quantity;
    ELSIF NEW.reserved_quantity > OLD.reserved_quantity
          AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN
      v_type := 'order_reserved';
      v_qty := NEW.reserved_quantity - OLD.reserved_quantity;
    ELSIF NEW.reserved_quantity < OLD.reserved_quantity
          AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN
      v_type := 'order_released';
      v_qty := OLD.reserved_quantity - NEW.reserved_quantity;
    ELSE
      v_type := 'adjustment';
      v_qty := GREATEST(abs(NEW.quantity - OLD.quantity), abs(NEW.reserved_quantity - OLD.reserved_quantity), 1);
    END IF;
  END IF;

  SELECT product_id INTO v_product_id
  FROM public.product_variants
  WHERE id = NEW.variant_id;

  INSERT INTO public.inventory_transactions (
    product_id,
    variant_id,
    type,
    quantity,
    reference,
    created_by
  )
  VALUES (
    v_product_id,
    NEW.variant_id,
    v_type,
    v_qty,
    current_setting('app.inventory_reference', true),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_log_change ON public.inventory;
CREATE TRIGGER trg_inventory_log_change
  AFTER INSERT OR UPDATE OF quantity, reserved_quantity ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.log_inventory_change();

-- ---------------------------------------------------------------------------
-- R&B MAISON category tree (taxonomy only — not mock products)
-- ---------------------------------------------------------------------------

INSERT INTO public.product_categories (name, slug, description, parent_id)
VALUES ('Women', 'women', 'Women''s collection', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.product_categories (name, slug, description, parent_id)
VALUES ('Men', 'men', 'Men''s collection', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.product_categories (name, slug, description, parent_id)
SELECT 'Women Bags', 'women-bags', 'Women''s bags', id
FROM public.product_categories
WHERE slug = 'women'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.product_categories (name, slug, description, parent_id)
SELECT 'Women Shoes', 'women-shoes', 'Women''s shoes', id
FROM public.product_categories
WHERE slug = 'women'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.product_categories (name, slug, description, parent_id)
SELECT 'Men Shoes', 'men-shoes', 'Men''s shoes', id
FROM public.product_categories
WHERE slug = 'men'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.product_categories (name, slug, description, parent_id)
SELECT 'Men Clothing', 'men-clothing', 'Men''s clothing', id
FROM public.product_categories
WHERE slug = 'men'
ON CONFLICT (slug) DO NOTHING;
