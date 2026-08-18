-- R&B MAISON — admin control center, merchant applications, shop details

CREATE TYPE public.merchant_application_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'suspended'
);

-- ---------------------------------------------------------------------------
-- merchant_applications
-- ---------------------------------------------------------------------------

CREATE TABLE public.merchant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  store_name text NOT NULL,
  business_description text,
  country text NOT NULL,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.merchant_application_status NOT NULL DEFAULT 'pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  merchant_id uuid REFERENCES public.merchants (id) ON DELETE RESTRICT,
  store_id uuid REFERENCES public.stores (id) ON DELETE RESTRICT,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_applications_store_name_chk CHECK (
    char_length(btrim(store_name)) BETWEEN 2 AND 120
  ),
  CONSTRAINT merchant_applications_country_chk CHECK (
    char_length(btrim(country)) BETWEEN 2 AND 56
  ),
  CONSTRAINT merchant_applications_documents_chk CHECK (
    jsonb_typeof(documents) = 'array'
  ),
  CONSTRAINT merchant_applications_review_chk CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending')
  )
);

CREATE INDEX idx_merchant_applications_user_id ON public.merchant_applications (user_id);
CREATE INDEX idx_merchant_applications_status ON public.merchant_applications (status);
CREATE INDEX idx_merchant_applications_submitted_at ON public.merchant_applications (submitted_at DESC);

CREATE UNIQUE INDEX merchant_applications_one_pending
  ON public.merchant_applications (user_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX merchant_applications_one_approved
  ON public.merchant_applications (user_id)
  WHERE status = 'approved';

COMMENT ON TABLE public.merchant_applications IS
  'Store applications. Merchant + store + merchant role are created only after admin approval.';

-- ---------------------------------------------------------------------------
-- merchant_credit_scores (append-only history; latest row is current score)
-- ---------------------------------------------------------------------------

CREATE TABLE public.merchant_credit_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants (id) ON DELETE RESTRICT,
  score numeric(6, 2) NOT NULL,
  reason text NOT NULL,
  updated_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_credit_scores_score_chk CHECK (score >= 0 AND score <= 100),
  CONSTRAINT merchant_credit_scores_reason_chk CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240)
);

CREATE INDEX idx_merchant_credit_scores_merchant
  ON public.merchant_credit_scores (merchant_id, created_at DESC);

COMMENT ON TABLE public.merchant_credit_scores IS
  'Append-only merchant credit history. Current score is the latest row per merchant.';

-- ---------------------------------------------------------------------------
-- store_followers (real follower counts; 0 until rows exist)
-- ---------------------------------------------------------------------------

CREATE TABLE public.store_followers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_followers_unique UNIQUE (store_id, user_id)
);

CREATE INDEX idx_store_followers_store_id ON public.store_followers (store_id);

COMMENT ON TABLE public.store_followers IS
  'Customer follows of a store. Shop statistics count this table; never a hardcoded value.';

-- ---------------------------------------------------------------------------
-- Immutability / column protection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_credit_score_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Credit score history is append-only';
END;
$$;

CREATE TRIGGER trg_merchant_credit_scores_no_update
  BEFORE UPDATE ON public.merchant_credit_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_credit_score_mutation();

CREATE TRIGGER trg_merchant_credit_scores_no_delete
  BEFORE DELETE ON public.merchant_credit_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_credit_score_mutation();

CREATE OR REPLACE FUNCTION public.protect_merchant_application_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'merchant_applications.user_id cannot be changed';
    END IF;

    IF (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
      OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.store_id IS DISTINCT FROM OLD.store_id
    ) AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Application review fields can only be changed by an admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_merchant_applications_protect
  BEFORE UPDATE ON public.merchant_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_merchant_application_columns();

CREATE TRIGGER trg_merchant_applications_set_updated_at
  BEFORE UPDATE ON public.merchant_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_merchant_credit_score(p_merchant_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT cs.score
      FROM public.merchant_credit_scores cs
      WHERE cs.merchant_id = p_merchant_id
      ORDER BY cs.created_at DESC
      LIMIT 1
    ),
    0
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.merchant_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_credit_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_followers ENABLE ROW LEVEL SECURITY;

CREATE POLICY merchant_applications_select_own_or_admin
  ON public.merchant_applications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY merchant_applications_insert_own
  ON public.merchant_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND public.is_customer()
  );

CREATE POLICY merchant_applications_update_admin
  ON public.merchant_applications
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY merchant_credit_scores_select_own_or_admin
  ON public.merchant_credit_scores
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR merchant_id = public.current_merchant_id()
    OR EXISTS (
      SELECT 1
      FROM public.merchants m
      WHERE m.id = merchant_credit_scores.merchant_id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY store_followers_select
  ON public.store_followers
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR store_id = public.current_store_id()
  );

CREATE POLICY store_followers_insert_own
  ON public.store_followers
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());

CREATE POLICY store_followers_delete_own_or_admin
  ON public.store_followers
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ---------------------------------------------------------------------------
-- Shared shop resolver: admin may pass any store; merchants only their own.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_shop_store_id(p_store_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_owned uuid;
BEGIN
  IF public.is_admin() THEN
    IF p_store_id IS NULL THEN
      RAISE EXCEPTION 'Store ID is required';
    END IF;

    SELECT s.id INTO v_store_id
    FROM public.stores s
    WHERE s.id = p_store_id;

    IF v_store_id IS NULL THEN
      RAISE EXCEPTION 'Store not found';
    END IF;

    RETURN v_store_id;
  END IF;

  SELECT s.id INTO v_owned
  FROM public.stores s
  JOIN public.merchants m ON m.id = s.merchant_id
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.user_id = auth.uid()
    AND p.role = 'merchant'
    AND p.status = 'active';

  IF v_owned IS NULL THEN
    RAISE EXCEPTION 'Only merchants can view their own store';
  END IF;

  IF p_store_id IS NOT NULL AND p_store_id IS DISTINCT FROM v_owned THEN
    RAISE EXCEPTION 'Merchants cannot access another store';
  END IF;

  RETURN v_owned;
END;
$$;

-- ---------------------------------------------------------------------------
-- Customer application
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_merchant_application(
  p_store_name text,
  p_business_description text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_documents jsonb DEFAULT '[]'::jsonb
)
RETURNS public.merchant_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles;
  v_row public.merchant_applications;
  v_country text;
  v_docs jsonb;
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
    RAISE EXCEPTION 'Only customers can apply for a store';
  END IF;

  IF EXISTS (SELECT 1 FROM public.merchants WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'A merchant account already exists for this user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_applications
    WHERE user_id = v_user_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending store application already exists';
  END IF;

  IF char_length(btrim(COALESCE(p_store_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Store name is required';
  END IF;

  v_country := btrim(COALESCE(p_country, v_profile.country, ''));
  IF char_length(v_country) < 2 THEN
    RAISE EXCEPTION 'Country is required';
  END IF;

  v_docs := COALESCE(p_documents, '[]'::jsonb);
  IF jsonb_typeof(v_docs) <> 'array' THEN
    RAISE EXCEPTION 'Documents must be a JSON array';
  END IF;

  INSERT INTO public.merchant_applications (
    user_id,
    store_name,
    business_description,
    country,
    documents,
    status
  )
  VALUES (
    v_user_id,
    btrim(p_store_name),
    NULLIF(btrim(COALESCE(p_business_description, '')), ''),
    v_country,
    v_docs,
    'pending'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_merchant_applications()
RETURNS SETOF public.merchant_applications
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
  FROM public.merchant_applications
  WHERE user_id = auth.uid()
  ORDER BY submitted_at DESC;
$$;

-- ---------------------------------------------------------------------------
-- Admin user management
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_email text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_store_id uuid DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  profile_id uuid,
  full_name text,
  email text,
  phone text,
  country text,
  role public.user_role,
  status public.profile_status,
  created_at timestamptz,
  last_login timestamptz,
  merchant_id uuid,
  store_id uuid,
  store_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search users';
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    p.id,
    p.full_name,
    p.email,
    p.phone,
    p.country,
    p.role,
    p.status,
    p.created_at,
    u.last_sign_in_at,
    m.id,
    COALESCE(m.store_id, s.id),
    COALESCE(s.store_name, m.store_name)
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  LEFT JOIN public.merchants m ON m.user_id = p.user_id
  LEFT JOIN public.stores s ON s.merchant_id = m.id
  WHERE (p_user_id IS NULL OR p.user_id = p_user_id)
    AND (p_merchant_id IS NULL OR m.id = p_merchant_id)
    AND (p_store_id IS NULL OR m.store_id = p_store_id OR s.id = p_store_id)
    AND (
      p_email IS NULL
      OR btrim(p_email) = ''
      OR p.email ILIKE '%' || btrim(p_email) || '%'
    )
    AND (
      p_query IS NULL
      OR btrim(p_query) = ''
      OR p.email ILIKE '%' || btrim(p_query) || '%'
      OR p.full_name ILIKE '%' || btrim(p_query) || '%'
      OR p.phone ILIKE '%' || btrim(p_query) || '%'
      OR p.user_id::text ILIKE '%' || btrim(p_query) || '%'
    )
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_user_id uuid,
  p_status public.profile_status
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.profiles;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change user status';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Admins cannot suspend or restore themselves';
  END IF;

  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'User status must be active or suspended';
  END IF;

  SELECT * INTO v_row
  FROM public.profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_row.role = 'admin' THEN
    RAISE EXCEPTION 'Admin accounts cannot be suspended from this endpoint';
  END IF;

  UPDATE public.profiles
  SET status = p_status
  WHERE user_id = p_user_id
  RETURNING * INTO v_row;

  PERFORM public.log_admin_action(
    CASE WHEN p_status = 'suspended' THEN 'suspend_user' ELSE 'restore_user' END,
    'profiles',
    v_row.id,
    'user_id=' || p_user_id::text || ' status=' || p_status::text
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin applications
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_search_applications(
  p_status public.merchant_application_status DEFAULT NULL,
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  application_id uuid,
  user_id uuid,
  applicant_name text,
  applicant_email text,
  store_name text,
  store_id uuid,
  merchant_id uuid,
  documents jsonb,
  country text,
  status public.merchant_application_status,
  submitted_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search merchant applications';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.user_id,
    p.full_name,
    p.email,
    a.store_name,
    a.store_id,
    a.merchant_id,
    a.documents,
    a.country,
    a.status,
    a.submitted_at,
    a.reviewed_at
  FROM public.merchant_applications a
  JOIN public.profiles p ON p.user_id = a.user_id
  WHERE (p_status IS NULL OR a.status = p_status)
    AND (
      p_query IS NULL
      OR btrim(p_query) = ''
      OR a.store_name ILIKE '%' || btrim(p_query) || '%'
      OR p.full_name ILIKE '%' || btrim(p_query) || '%'
      OR p.email ILIKE '%' || btrim(p_query) || '%'
      OR a.id::text ILIKE '%' || btrim(p_query) || '%'
    )
  ORDER BY a.submitted_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_merchant_application(p_id uuid)
RETURNS TABLE (
  application_id uuid,
  merchant_id uuid,
  store_id uuid,
  user_id uuid,
  role public.user_role,
  store_name text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.merchant_applications;
  v_profile public.profiles;
  v_merchant public.merchants;
  v_store public.stores;
  v_role public.user_role;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve stores';
  END IF;

  SELECT * INTO v_app
  FROM public.merchant_applications
  WHERE id = p_id
  FOR UPDATE;

  IF v_app.id IS NOT NULL THEN
    IF v_app.status <> 'pending' THEN
      RAISE EXCEPTION 'Application is not pending';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles AS p
    WHERE p.user_id = v_app.user_id
    FOR UPDATE;

    IF v_profile.id IS NULL THEN
      RAISE EXCEPTION 'Applicant profile not found';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.merchants AS m WHERE m.user_id = v_app.user_id
    ) THEN
      RAISE EXCEPTION 'A merchant account already exists for this user';
    END IF;

    INSERT INTO public.merchants (
      user_id,
      store_name,
      business_email,
      phone,
      country,
      verification_status,
      status,
      wholesale_enabled
    )
    VALUES (
      v_app.user_id,
      v_app.store_name,
      lower(btrim(v_profile.email)),
      v_profile.phone,
      v_app.country,
      'approved',
      'active',
      true
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
      v_app.store_name,
      v_app.business_description,
      'active'
    )
    RETURNING * INTO v_store;

    UPDATE public.profiles AS p
    SET role = 'merchant',
        country = COALESCE(p.country, v_app.country)
    WHERE p.user_id = v_app.user_id;

    INSERT INTO public.merchant_credit_scores (
      merchant_id,
      score,
      reason,
      updated_by
    )
    VALUES (
      v_merchant.id,
      100,
      'Initial merchant credit score',
      auth.uid()
    );

    UPDATE public.merchant_applications AS a
    SET status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        merchant_id = v_merchant.id,
        store_id = v_store.id
    WHERE a.id = v_app.id
    RETURNING * INTO v_app;

    PERFORM public.log_admin_action(
      'approve_merchant',
      'merchant_applications',
      v_app.id,
      'store=' || v_store.store_name || ' merchant_id=' || v_merchant.id::text
    );

    SELECT p.role INTO v_role
    FROM public.profiles AS p
    WHERE p.user_id = v_app.user_id;

    application_id := v_app.id;
    merchant_id := v_merchant.id;
    store_id := v_store.id;
    user_id := v_app.user_id;
    role := v_role;
    store_name := v_store.store_name;
    status := 'approved';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Invitation-created merchant: p_id is merchants.id
  SELECT * INTO v_merchant
  FROM public.merchants
  WHERE id = p_id
  FOR UPDATE;

  IF v_merchant.id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  UPDATE public.merchants AS m
  SET verification_status = 'approved',
      status = 'active',
      wholesale_enabled = true
  WHERE m.id = v_merchant.id
  RETURNING * INTO v_merchant;

  UPDATE public.stores AS s
  SET status = 'active'
  WHERE s.merchant_id = v_merchant.id
  RETURNING * INTO v_store;

  UPDATE public.profiles AS p
  SET role = 'merchant'
  WHERE p.user_id = v_merchant.user_id
    AND p.role = 'customer';

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_credit_scores AS cs
    WHERE cs.merchant_id = v_merchant.id
  ) THEN
    INSERT INTO public.merchant_credit_scores (
      merchant_id,
      score,
      reason,
      updated_by
    )
    VALUES (
      v_merchant.id,
      100,
      'Initial merchant credit score',
      auth.uid()
    );
  END IF;

  PERFORM public.log_admin_action(
    'approve_merchant',
    'merchants',
    v_merchant.id,
    'store=' || COALESCE(v_store.store_name, v_merchant.store_name)
  );

  SELECT p.role INTO v_role
  FROM public.profiles AS p
  WHERE p.user_id = v_merchant.user_id;

  application_id := NULL;
  merchant_id := v_merchant.id;
  store_id := COALESCE(v_store.id, v_merchant.store_id);
  user_id := v_merchant.user_id;
  role := v_role;
  store_name := COALESCE(v_store.store_name, v_merchant.store_name);
  status := 'approved';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_merchant_application(
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  application_id uuid,
  merchant_id uuid,
  user_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.merchant_applications;
  v_merchant public.merchants;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject stores';
  END IF;

  SELECT * INTO v_app
  FROM public.merchant_applications
  WHERE id = p_id
  FOR UPDATE;

  IF v_app.id IS NOT NULL THEN
    IF v_app.status <> 'pending' THEN
      RAISE EXCEPTION 'Application is not pending';
    END IF;

    UPDATE public.merchant_applications AS a
    SET status = 'rejected',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
    WHERE a.id = v_app.id
    RETURNING * INTO v_app;

    PERFORM public.log_admin_action(
      'reject_merchant',
      'merchant_applications',
      v_app.id,
      COALESCE(p_reason, 'rejected')
    );

    application_id := v_app.id;
    merchant_id := NULL;
    user_id := v_app.user_id;
    status := 'rejected';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_merchant
  FROM public.merchants
  WHERE id = p_id
  FOR UPDATE;

  IF v_merchant.id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  UPDATE public.merchants
  SET verification_status = 'rejected'
  WHERE id = v_merchant.id
  RETURNING * INTO v_merchant;

  PERFORM public.log_admin_action(
    'reject_merchant',
    'merchants',
    v_merchant.id,
    COALESCE(p_reason, 'rejected')
  );

  application_id := NULL;
  merchant_id := v_merchant.id;
  user_id := v_merchant.user_id;
  status := 'rejected';
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Shop details / statistics / financials (real aggregates)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.shop_details(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  store_id uuid,
  store_name text,
  logo text,
  description text,
  owner_user_id uuid,
  owner_name text,
  owner_email text,
  owner_phone text,
  country text,
  status public.store_status,
  approval_date timestamptz,
  merchant_id uuid,
  verification_status public.verification_status,
  merchant_status public.merchant_status,
  wholesale_enabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  v_store_id := public.resolve_shop_store_id(p_store_id);

  RETURN QUERY
  SELECT
    s.id,
    s.store_name,
    s.logo,
    s.description,
    m.user_id,
    p.full_name,
    p.email,
    COALESCE(m.phone, p.phone),
    COALESCE(m.country, p.country),
    s.status,
    COALESCE(a.reviewed_at, s.created_at),
    m.id,
    m.verification_status,
    m.status,
    m.wholesale_enabled
  FROM public.stores s
  JOIN public.merchants m ON m.id = s.merchant_id
  JOIN public.profiles p ON p.user_id = m.user_id
  LEFT JOIN LATERAL (
    SELECT ma.reviewed_at
    FROM public.merchant_applications ma
    WHERE ma.store_id = s.id
      AND ma.status IN ('approved', 'suspended')
    ORDER BY ma.reviewed_at DESC NULLS LAST
    LIMIT 1
  ) a ON true
  WHERE s.id = v_store_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_statistics(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  store_id uuid,
  merchant_id uuid,
  total_products_listed bigint,
  active_products bigint,
  removed_products bigint,
  total_orders bigint,
  todays_orders bigint,
  completed_orders bigint,
  pending_orders bigint,
  total_sales numeric,
  todays_sales numeric,
  total_profit numeric,
  todays_profit numeric,
  total_followers bigint,
  credit_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_merchant_id uuid;
  v_today date;
BEGIN
  v_store_id := public.resolve_shop_store_id(p_store_id);
  v_today := (timezone('utc', now()))::date;

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = v_store_id;

  RETURN QUERY
  SELECT
    v_store_id,
    v_merchant_id,
    (SELECT count(*) FROM public.merchant_product_listings mpl WHERE mpl.merchant_id = v_merchant_id),
    (SELECT count(*) FROM public.merchant_product_listings mpl WHERE mpl.merchant_id = v_merchant_id AND mpl.status = 'active'),
    (SELECT count(*) FROM public.merchant_product_listings mpl WHERE mpl.merchant_id = v_merchant_id AND mpl.status = 'removed'),
    (SELECT count(*) FROM public.orders o WHERE o.store_id = v_store_id),
    (
      SELECT count(*)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND (timezone('utc', o.created_at))::date = v_today
    ),
    (
      SELECT count(*)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status = 'delivered'
    ),
    (
      SELECT count(*)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('pending', 'awaiting_payment', 'confirmed')
    ),
    (
      SELECT coalesce(sum(o.total_amount), 0)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('paid', 'processing', 'shipping', 'shipped', 'delivered')
    ),
    (
      SELECT coalesce(sum(o.total_amount), 0)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('paid', 'processing', 'shipping', 'shipped', 'delivered')
        AND (timezone('utc', o.created_at))::date = v_today
    ),
    (
      SELECT coalesce(sum(oi.merchant_profit), 0)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.store_id = v_store_id
        AND o.status = 'delivered'
    ),
    (
      SELECT coalesce(sum(oi.merchant_profit), 0)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.store_id = v_store_id
        AND o.status = 'delivered'
        AND (timezone('utc', o.updated_at))::date = v_today
    ),
    (SELECT count(*) FROM public.store_followers sf WHERE sf.store_id = v_store_id),
    public.current_merchant_credit_score(v_merchant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_financials(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  currency public.supported_currency,
  wallet_id uuid,
  wallet_balance numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  order_payments numeric,
  profit_releases numeric,
  refunds numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_merchant_id uuid;
BEGIN
  v_store_id := public.resolve_shop_store_id(p_store_id);

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = v_store_id;

  RETURN QUERY
  SELECT
    w.currency,
    w.id,
    w.balance,
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'deposit'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'withdrawal'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'order_payment'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'profit_release'
    ), 0),
    coalesce((
      SELECT sum(tx.amount)
      FROM public.wallet_transactions tx
      WHERE tx.wallet_id = w.id
        AND tx.status = 'completed'
        AND tx.type = 'refund'
    ), 0)
  FROM public.wallets w
  WHERE w.merchant_id = v_merchant_id
  ORDER BY w.currency;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_shop_products(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  listing_id uuid,
  product_id uuid,
  image text,
  name text,
  category text,
  sales_price numeric,
  profit numeric,
  listing_date timestamptz,
  status public.listing_status
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_merchant_id uuid;
BEGIN
  v_store_id := public.resolve_shop_store_id(p_store_id);

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = v_store_id;

  RETURN QUERY
  SELECT
    mpl.id,
    pr.id,
    (
      SELECT coalesce(img.image_url, img.storage_path)
      FROM public.product_images img
      WHERE img.product_id = pr.id
      ORDER BY img.is_primary DESC, img.position ASC
      LIMIT 1
    ),
    pr.name,
    cat.name,
    mpl.sales_price,
    (mpl.sales_price - mpl.wholesale_price),
    mpl.created_at,
    mpl.status
  FROM public.merchant_product_listings mpl
  JOIN public.products pr ON pr.id = mpl.product_id
  JOIN public.product_categories cat ON cat.id = pr.category_id
  WHERE mpl.merchant_id = v_merchant_id
  ORDER BY mpl.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_shop_orders(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  order_id uuid,
  product text,
  customer_id uuid,
  customer_name text,
  customer_email text,
  amount numeric,
  wholesale_amount numeric,
  profit numeric,
  status public.order_status,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  v_store_id := public.resolve_shop_store_id(p_store_id);

  RETURN QUERY
  SELECT
    o.id,
    string_agg(pr.name, ', ' ORDER BY oi.created_at),
    o.customer_id,
    cp.full_name,
    cp.email,
    o.total_amount,
    public.order_wholesale_due(o.id),
    coalesce(sum(oi.merchant_profit), 0),
    o.status,
    o.created_at
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.products pr ON pr.id = oi.product_id
  JOIN public.profiles cp ON cp.user_id = o.customer_id
  WHERE o.store_id = v_store_id
  GROUP BY
    o.id,
    o.customer_id,
    cp.full_name,
    cp.email,
    o.total_amount,
    o.status,
    o.created_at
  ORDER BY o.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin store search and control
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_search_stores(
  p_store_id uuid DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_store_name text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  store_id uuid,
  store_name text,
  merchant_id uuid,
  owner_name text,
  owner_email text,
  country text,
  status public.store_status,
  verification_status public.verification_status,
  wholesale_enabled boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search stores';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.store_name,
    m.id,
    p.full_name,
    p.email,
    m.country,
    s.status,
    m.verification_status,
    m.wholesale_enabled,
    s.created_at
  FROM public.stores s
  JOIN public.merchants m ON m.id = s.merchant_id
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE (p_store_id IS NULL OR s.id = p_store_id)
    AND (p_merchant_id IS NULL OR m.id = p_merchant_id)
    AND (
      p_store_name IS NULL
      OR btrim(p_store_name) = ''
      OR s.store_name ILIKE '%' || btrim(p_store_name) || '%'
    )
    AND (
      p_email IS NULL
      OR btrim(p_email) = ''
      OR p.email ILIKE '%' || btrim(p_email) || '%'
      OR m.business_email ILIKE '%' || btrim(p_email) || '%'
    )
  ORDER BY s.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_store_status(
  p_store_id uuid,
  p_status public.store_status,
  p_reason text DEFAULT NULL
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.stores;
  v_merchant_status public.merchant_status;
  v_app_status public.merchant_application_status;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change store status';
  END IF;

  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Store status must be active or suspended';
  END IF;

  SELECT * INTO v_store
  FROM public.stores
  WHERE id = p_store_id
  FOR UPDATE;

  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  v_merchant_status := CASE WHEN p_status = 'suspended' THEN 'suspended' ELSE 'active' END;
  v_app_status := CASE WHEN p_status = 'suspended' THEN 'suspended' ELSE 'approved' END;

  UPDATE public.stores
  SET status = p_status
  WHERE id = p_store_id
  RETURNING * INTO v_store;

  UPDATE public.merchants
  SET status = v_merchant_status,
      verification_status = CASE
        WHEN p_status = 'active' THEN 'approved'::public.verification_status
        ELSE verification_status
      END
  WHERE id = v_store.merchant_id;

  UPDATE public.merchant_applications
  SET status = v_app_status,
      reviewed_by = COALESCE(reviewed_by, auth.uid()),
      reviewed_at = COALESCE(reviewed_at, now())
  WHERE store_id = p_store_id
    AND status IN ('approved', 'suspended');

  PERFORM public.log_admin_action(
    CASE WHEN p_status = 'suspended' THEN 'suspend_store' ELSE 'approve_store' END,
    'stores',
    v_store.id,
    COALESCE(p_reason, 'status=' || p_status::text)
  );

  RETURN v_store;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_store_wallet(
  p_store_id uuid,
  p_amount numeric,
  p_direction public.wallet_transaction_direction,
  p_reason text,
  p_currency public.supported_currency DEFAULT 'USD'
)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can adjust store balances';
  END IF;

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  RETURN public.admin_adjust_merchant_wallet(
    v_merchant_id,
    p_currency,
    p_amount,
    p_direction,
    p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_credit_score(
  p_merchant_id uuid,
  p_score numeric,
  p_reason text
)
RETURNS public.merchant_credit_scores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.merchant_credit_scores;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change credit scores';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = p_merchant_id) THEN
    RAISE EXCEPTION 'Merchant not found';
  END IF;

  INSERT INTO public.merchant_credit_scores (
    merchant_id,
    score,
    reason,
    updated_by
  )
  VALUES (
    p_merchant_id,
    p_score,
    btrim(p_reason),
    auth.uid()
  )
  RETURNING * INTO v_row;

  PERFORM public.log_admin_action(
    'adjust_credit_score',
    'merchant_credit_scores',
    v_row.id,
    'merchant_id=' || p_merchant_id::text || ' score=' || p_score::text || ' ' || btrim(p_reason)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_store_credit(
  p_store_id uuid,
  p_score numeric,
  p_reason text
)
RETURNS public.merchant_credit_scores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change credit scores';
  END IF;

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  RETURN public.admin_adjust_credit_score(v_merchant_id, p_score, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_store_wholesale_access(
  p_store_id uuid,
  p_enabled boolean
)
RETURNS public.merchants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change wholesale access';
  END IF;

  SELECT s.merchant_id INTO v_merchant_id
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  RETURN public.admin_set_merchant_wholesale_access(v_merchant_id, p_enabled);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_activity_logs(
  p_action text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS SETOF public.admin_activity_logs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can read activity logs';
  END IF;

  RETURN QUERY
  SELECT l.*
  FROM public.admin_activity_logs l
  WHERE (
      p_action IS NULL
      OR btrim(p_action) = ''
      OR l.action = btrim(p_action)
    )
    AND (
      p_target_type IS NULL
      OR btrim(p_target_type) = ''
      OR l.target_type = btrim(p_target_type)
    )
  ORDER BY l."timestamp" DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;

CREATE OR REPLACE FUNCTION public.merchant_credit_history()
RETURNS SETOF public.merchant_credit_scores
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
  FROM public.merchant_credit_scores
  WHERE merchant_id = public.current_merchant_id()
     OR EXISTS (
       SELECT 1
       FROM public.merchants m
       WHERE m.id = merchant_credit_scores.merchant_id
         AND m.user_id = auth.uid()
     )
  ORDER BY created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.current_merchant_credit_score(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_shop_store_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_merchant_application(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_merchant_applications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_users(text, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, public.profile_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_applications(public.merchant_application_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_approve_merchant_application(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_merchant_application(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_details(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_statistics(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_financials(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_shop_products(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_shop_orders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_stores(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_store_status(uuid, public.store_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_store_wallet(uuid, numeric, public.wallet_transaction_direction, text, public.supported_currency) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_credit_score(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_store_credit(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_store_wholesale_access(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_activity_logs(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_credit_history() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_merchant_credit_score(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_shop_store_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_merchant_application(text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_merchant_applications() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, public.profile_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_applications(public.merchant_application_status, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_merchant_application(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_merchant_application(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shop_details(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shop_statistics(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shop_financials(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_shop_products(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_shop_orders(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_stores(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_store_status(uuid, public.store_status, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_store_wallet(uuid, numeric, public.wallet_transaction_direction, text, public.supported_currency) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credit_score(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_store_credit(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_store_wholesale_access(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_activity_logs(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_credit_history() TO authenticated, service_role;
