-- R&B MAISON — central product catalogue
-- Products belong to the platform catalogue. Merchants never own or duplicate products.

CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  parent_id uuid REFERENCES public.product_categories (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_categories_name_chk CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT product_categories_slug_chk CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT product_categories_parent_not_self_chk CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX idx_product_categories_parent_id ON public.product_categories (parent_id);

CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brands_name_chk CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT brands_slug_chk CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES public.product_categories (id) ON DELETE RESTRICT,
  price numeric(18, 2) NOT NULL,
  currency public.supported_currency NOT NULL DEFAULT 'USD',
  status public.product_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_name_chk CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  CONSTRAINT products_price_chk CHECK (price > 0)
);

CREATE INDEX idx_products_brand_id ON public.products (brand_id);
CREATE INDEX idx_products_category_id ON public.products (category_id);
CREATE INDEX idx_products_status ON public.products (status);
CREATE INDEX idx_products_name ON public.products (name);

CREATE TABLE public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_images_path_chk CHECK (char_length(storage_path) BETWEEN 1 AND 500),
  CONSTRAINT product_images_sort_chk CHECK (sort_order >= 0)
);

CREATE INDEX idx_product_images_product_id ON public.product_images (product_id, sort_order);

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  size text,
  color text,
  sku text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_sku_chk CHECK (char_length(btrim(sku)) BETWEEN 3 AND 64),
  CONSTRAINT product_variants_option_chk CHECK (
    size IS NOT NULL OR color IS NOT NULL
  )
);

CREATE UNIQUE INDEX uq_product_variants_product_size_color
  ON public.product_variants (
    product_id,
    coalesce(size, ''),
    coalesce(color, '')
  );

CREATE INDEX idx_product_variants_product_id ON public.product_variants (product_id);

CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL UNIQUE REFERENCES public.product_variants (id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0,
  availability boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_quantity_chk CHECK (quantity >= 0)
);

CREATE INDEX idx_inventory_availability ON public.inventory (availability);

COMMENT ON TABLE public.products IS
  'Platform catalogue. Merchants sell via merchant_product_listings; they do not duplicate these rows.';

CREATE OR REPLACE FUNCTION public.sync_inventory_availability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quantity = 0 THEN
    NEW.availability := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_sync_availability
  BEFORE INSERT OR UPDATE OF quantity, availability ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_inventory_availability();

CREATE OR REPLACE FUNCTION public.create_variant_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inventory (variant_id, quantity, availability)
  VALUES (NEW.id, 0, false);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_variants_create_inventory
  AFTER INSERT ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.create_variant_inventory();

CREATE TRIGGER trg_product_categories_set_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_brands_set_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_product_images_set_updated_at
  BEFORE UPDATE ON public.product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_product_variants_set_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_inventory_set_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_product_categories_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.product_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_brands_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_products_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_product_images_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_product_variants_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_inventory_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();
