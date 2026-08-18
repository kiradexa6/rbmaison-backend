-- R&B MAISON — merchants and stores (1:1)

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE RESTRICT,
  store_id uuid UNIQUE,
  store_name text NOT NULL,
  business_email text NOT NULL,
  phone text,
  country text NOT NULL,
  verification_status public.verification_status NOT NULL DEFAULT 'pending',
  status public.merchant_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchants_store_name_chk CHECK (char_length(btrim(store_name)) BETWEEN 2 AND 120),
  CONSTRAINT merchants_business_email_chk CHECK (
    business_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  CONSTRAINT merchants_phone_chk CHECK (
    phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'
  ),
  CONSTRAINT merchants_country_chk CHECK (char_length(country) BETWEEN 2 AND 56)
);

CREATE INDEX idx_merchants_status ON public.merchants (status);
CREATE INDEX idx_merchants_verification_status ON public.merchants (verification_status);
CREATE INDEX idx_merchants_country ON public.merchants (country);
CREATE INDEX idx_merchants_created_at ON public.merchants (created_at DESC);

CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL UNIQUE REFERENCES public.merchants (id) ON DELETE RESTRICT,
  store_name text NOT NULL,
  description text,
  logo text,
  status public.store_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_store_name_chk CHECK (char_length(btrim(store_name)) BETWEEN 2 AND 120)
);

CREATE INDEX idx_stores_status ON public.stores (status);
CREATE INDEX idx_stores_created_at ON public.stores (created_at DESC);

ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES public.stores (id) ON DELETE RESTRICT;

COMMENT ON TABLE public.merchants IS
  'One merchant account per auth user. store_id is assigned when the store row is created.';

COMMENT ON TABLE public.stores IS
  'One store per merchant. Catalogue products are not owned by stores.';

CREATE OR REPLACE FUNCTION public.current_merchant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.merchants m
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
    AND p.status = 'active'
    AND p.role IN ('merchant', 'admin')
$$;

CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id
  FROM public.stores s
  JOIN public.merchants m ON m.id = s.merchant_id
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
    AND p.status = 'active'
$$;

REVOKE ALL ON FUNCTION public.current_merchant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_store_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_merchant_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_store_id() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_store_id_on_merchant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.merchants
  SET store_id = NEW.id,
      store_name = NEW.store_name,
      updated_at = now()
  WHERE id = NEW.merchant_id
    AND (store_id IS NULL OR store_id = NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stores_sync_merchant
  AFTER INSERT OR UPDATE OF store_name ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_store_id_on_merchant();

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

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_merchants_protect
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_merchant_security_columns();

CREATE OR REPLACE FUNCTION public.apply_merchant_verification_to_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.store_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.verification_status = 'approved'
     AND NEW.status = 'active'
     AND (OLD.verification_status IS DISTINCT FROM NEW.verification_status
          OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.stores
    SET status = 'active'
    WHERE id = NEW.store_id
      AND status = 'pending';
  END IF;

  IF NEW.status IN ('suspended', 'blocked')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.stores
    SET status = 'suspended'
    WHERE id = NEW.store_id
      AND status <> 'suspended';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_merchants_sync_store_status
  AFTER UPDATE OF verification_status, status ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_merchant_verification_to_store();

CREATE OR REPLACE FUNCTION public.protect_store_security_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'stores.merchant_id cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Store status can only be changed by an admin';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stores_protect
  BEFORE UPDATE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_store_security_columns();

CREATE TRIGGER trg_merchants_set_updated_at
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_stores_set_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_merchants_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_stores_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE OR REPLACE FUNCTION public.register_merchant_with_invitation(
  p_invitation_code text,
  p_store_name text,
  p_business_email text,
  p_phone text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS public.merchants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles;
  v_code public.merchant_invitation_codes;
  v_merchant public.merchants;
  v_store public.stores;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  IF v_profile.role <> 'customer' THEN
    RAISE EXCEPTION 'Only customer accounts can become merchants';
  END IF;

  IF EXISTS (SELECT 1 FROM public.merchants WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'A merchant account already exists for this user';
  END IF;

  IF char_length(btrim(p_store_name)) < 2 THEN
    RAISE EXCEPTION 'Store name is required';
  END IF;

  IF char_length(btrim(COALESCE(p_country, v_profile.country, ''))) < 2 THEN
    RAISE EXCEPTION 'Country is required';
  END IF;

  UPDATE public.merchant_invitation_codes
  SET used_count = used_count + 1
  WHERE code = upper(btrim(p_invitation_code))
    AND active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_usage
  RETURNING * INTO v_code;

  IF v_code.id IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or exhausted invitation code';
  END IF;

  INSERT INTO public.merchants (
    user_id,
    store_name,
    business_email,
    phone,
    country,
    verification_status,
    status
  )
  VALUES (
    v_user_id,
    btrim(p_store_name),
    lower(btrim(p_business_email)),
    NULLIF(btrim(COALESCE(p_phone, '')), ''),
    btrim(COALESCE(p_country, v_profile.country, '')),
    'pending',
    'active'
  )
  RETURNING * INTO v_merchant;

  INSERT INTO public.stores (
    merchant_id,
    store_name,
    description,
    status
  )
  VALUES (
    v_merchant.id,
    btrim(p_store_name),
    NULL,
    'pending'
  )
  RETURNING * INTO v_store;

  UPDATE public.profiles
  SET role = 'merchant',
      phone = COALESCE(profiles.phone, v_merchant.phone),
      country = COALESCE(profiles.country, v_merchant.country)
  WHERE user_id = v_user_id;

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_merchant.id;
  RETURN v_merchant;
END;
$$;

REVOKE ALL ON FUNCTION public.register_merchant_with_invitation(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_merchant_with_invitation(text, text, text, text, text) TO authenticated, service_role;
