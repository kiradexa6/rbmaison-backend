-- R&B MAISON — merchant listings against the central catalogue
-- Wholesale price is always sales_price minus 20% and cannot be supplied by the client.

CREATE TABLE public.merchant_product_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  sales_price numeric(18, 2) NOT NULL,
  wholesale_price numeric(18, 2) GENERATED ALWAYS AS (
    round(sales_price * 0.80::numeric, 2)
  ) STORED,
  discount_percentage numeric(5, 2) NOT NULL DEFAULT 20,
  status public.listing_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_product_listings_sales_price_chk CHECK (sales_price > 0),
  CONSTRAINT merchant_product_listings_discount_chk CHECK (discount_percentage = 20),
  CONSTRAINT merchant_product_listings_merchant_product_uq UNIQUE (merchant_id, product_id)
);

CREATE INDEX idx_merchant_product_listings_merchant_id ON public.merchant_product_listings (merchant_id);
CREATE INDEX idx_merchant_product_listings_product_id ON public.merchant_product_listings (product_id);
CREATE INDEX idx_merchant_product_listings_status ON public.merchant_product_listings (status);

COMMENT ON TABLE public.merchant_product_listings IS
  'Merchant offer against a catalogue product. The merchant does not own the product row.';

CREATE OR REPLACE FUNCTION public.protect_listing_columns()
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

  IF TG_OP = 'INSERT' THEN
    IF NOT v_admin AND NEW.merchant_id IS DISTINCT FROM v_merchant_id THEN
      RAISE EXCEPTION 'Merchants can only create listings for their own account';
    END IF;

    IF NOT v_admin THEN
      NEW.status := 'pending';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'listing merchant_id cannot be changed';
  END IF;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'listing product_id cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_admin THEN
    IF NOT (OLD.status IN ('pending', 'active') AND NEW.status = 'inactive'
            AND OLD.merchant_id = v_merchant_id) THEN
      RAISE EXCEPTION 'Listing status can only be changed by an admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_listings_protect
  BEFORE INSERT OR UPDATE ON public.merchant_product_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_listing_columns();

CREATE TRIGGER trg_listings_set_updated_at
  BEFORE UPDATE ON public.merchant_product_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_listings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.merchant_product_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();
