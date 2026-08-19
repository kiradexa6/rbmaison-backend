-- R&B MAISON — admin-controlled historical account data + store viewers
-- Generates records only for an admin-selected existing account. Never runs on signup.

CREATE TYPE public.historical_run_status AS ENUM (
  'preview',
  'running',
  'completed',
  'failed',
  'reversed'
);

CREATE TYPE public.historical_activity_level AS ENUM (
  'low',
  'medium',
  'high'
);

CREATE TABLE public.store_viewer_settings (
  store_id uuid PRIMARY KEY REFERENCES public.stores (id) ON DELETE CASCADE,
  viewer_count integer NOT NULL,
  reason text NOT NULL,
  updated_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_viewer_settings_count_chk CHECK (viewer_count >= 0 AND viewer_count <= 1000000),
  CONSTRAINT store_viewer_settings_reason_chk CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240)
);

COMMENT ON TABLE public.store_viewer_settings IS
  'Admin-set displayed store viewer count. When absent, shop statistics use store_followers.';

CREATE TABLE public.admin_historical_data_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  merchant_id uuid REFERENCES public.merchants (id) ON DELETE RESTRICT,
  store_id uuid REFERENCES public.stores (id) ON DELETE RESTRICT,
  period_from timestamptz NOT NULL,
  period_to timestamptz NOT NULL,
  categories text[] NOT NULL,
  activity_level public.historical_activity_level NOT NULL,
  idempotency_key text,
  status public.historical_run_status NOT NULL DEFAULT 'running',
  created_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reversed_at timestamptz,
  CONSTRAINT admin_historical_data_runs_period_chk CHECK (period_from < period_to),
  CONSTRAINT admin_historical_data_runs_categories_chk CHECK (cardinality(categories) >= 1),
  CONSTRAINT admin_historical_data_runs_idempotency_chk CHECK (
    idempotency_key IS NULL OR char_length(btrim(idempotency_key)) BETWEEN 8 AND 80
  )
);

CREATE UNIQUE INDEX uq_admin_historical_data_runs_idempotency
  ON public.admin_historical_data_runs (admin_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_admin_historical_data_runs_target
  ON public.admin_historical_data_runs (target_user_id, created_at DESC);

CREATE INDEX idx_admin_historical_data_runs_status
  ON public.admin_historical_data_runs (status);

ALTER TABLE public.store_viewer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_historical_data_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_viewer_settings_admin_all
  ON public.store_viewer_settings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY store_viewer_settings_merchant_select
  ON public.store_viewer_settings
  FOR SELECT
  TO authenticated
  USING (store_id = public.current_store_id() OR public.is_admin());

CREATE POLICY admin_historical_data_runs_admin_all
  ON public.admin_historical_data_runs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.store_viewer_settings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_historical_data_runs FROM anon, authenticated;
GRANT SELECT ON public.store_viewer_settings TO authenticated;
GRANT SELECT ON public.admin_historical_data_runs TO authenticated;

-- ---------------------------------------------------------------------------
-- Notification suppression during generation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type public.notification_type,
  p_title text,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.notifications;
BEGIN
  IF current_setting('app.suppress_notifications', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Notification user is required';
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    data
  )
  VALUES (
    p_user_id,
    p_type,
    btrim(p_title),
    btrim(p_message),
    COALESCE(p_data, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_displayed_viewer_count(p_store_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT svs.viewer_count::bigint
      FROM public.store_viewer_settings svs
      WHERE svs.store_id = p_store_id
    ),
    (
      SELECT count(*)
      FROM public.store_followers sf
      WHERE sf.store_id = p_store_id
    )
  );
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
        AND o.status IN ('delivered', 'completed')
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
        AND o.status IN ('paid', 'processing', 'shipping', 'shipped', 'delivered', 'completed')
    ),
    (
      SELECT coalesce(sum(o.total_amount), 0)
      FROM public.orders o
      WHERE o.store_id = v_store_id
        AND o.status IN ('paid', 'processing', 'shipping', 'shipped', 'delivered', 'completed')
        AND (timezone('utc', o.created_at))::date = v_today
    ),
    (
      SELECT coalesce(sum(oi.merchant_profit), 0)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.store_id = v_store_id
        AND o.status IN ('delivered', 'completed')
    ),
    (
      SELECT coalesce(sum(oi.merchant_profit), 0)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.store_id = v_store_id
        AND o.status IN ('delivered', 'completed')
        AND (timezone('utc', o.updated_at))::date = v_today
    ),
    public.store_displayed_viewer_count(v_store_id),
    public.current_merchant_credit_score(v_merchant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_store_viewers(
  p_store_id uuid,
  p_viewer_count integer,
  p_reason text
)
RETURNS public.store_viewer_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.store_viewer_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can adjust store viewers';
  END IF;

  IF p_viewer_count IS NULL OR p_viewer_count < 0 OR p_viewer_count > 1000000 THEN
    RAISE EXCEPTION 'Viewer count must be between 0 and 1000000';
  END IF;

  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reason is required for viewer adjustments';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = p_store_id) THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  INSERT INTO public.store_viewer_settings (
    store_id,
    viewer_count,
    reason,
    updated_by
  )
  VALUES (
    p_store_id,
    p_viewer_count,
    btrim(p_reason),
    auth.uid()
  )
  ON CONFLICT (store_id) DO UPDATE
    SET
      viewer_count = EXCLUDED.viewer_count,
      reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  RETURNING * INTO v_row;

  PERFORM public.log_admin_action(
    'adjust_store_viewers',
    'stores',
    p_store_id,
    'viewer_count=' || p_viewer_count::text
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.historical_unit_rand(p_seed text, p_n integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (abs(('x' || substr(md5(p_seed || ':' || p_n::text), 1, 8))::bit(32)::int) % 10000)::numeric / 10000;
$$;

CREATE OR REPLACE FUNCTION public.historical_resolve_period(
  p_preset text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS timestamptz[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_now timestamptz := now();
  v_to timestamptz := v_now;
  v_from timestamptz;
  v_max interval := interval '180 days';
BEGIN
  IF p_preset = 'custom' THEN
    IF p_from IS NULL OR p_to IS NULL THEN
      RAISE EXCEPTION 'Custom range requires from and to dates';
    END IF;
    v_from := p_from;
    v_to := p_to;
  ELSIF p_preset = 'last_7_days' THEN
    v_from := v_to - interval '7 days';
  ELSIF p_preset = 'last_30_days' THEN
    v_from := v_to - interval '30 days';
  ELSIF p_preset = 'last_90_days' THEN
    v_from := v_to - interval '90 days';
  ELSIF p_preset = 'last_180_days' THEN
    v_from := v_to - v_max;
  ELSE
    RAISE EXCEPTION 'Invalid historical range preset';
  END IF;

  IF v_to > v_now THEN
    RAISE EXCEPTION 'Future dates are not allowed';
  END IF;

  IF v_from >= v_to THEN
    RAISE EXCEPTION 'Historical from date must be before to date';
  END IF;

  IF v_to - v_from > v_max OR v_from < v_now - v_max THEN
    RAISE EXCEPTION 'Historical range cannot exceed 6 months';
  END IF;

  RETURN ARRAY[v_from, v_to];
END;
$$;

CREATE OR REPLACE FUNCTION public.historical_activity_plan(
  p_level public.historical_activity_level
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'low' THEN jsonb_build_object(
      'deposits', 6, 'rejected_deposits', 2, 'withdrawals', 3, 'rejected_withdrawals', 1, 'orders', 8
    )
    WHEN 'medium' THEN jsonb_build_object(
      'deposits', 12, 'rejected_deposits', 3, 'withdrawals', 6, 'rejected_withdrawals', 2, 'orders', 16
    )
    ELSE jsonb_build_object(
      'deposits', 20, 'rejected_deposits', 4, 'withdrawals', 10, 'rejected_withdrawals', 3, 'orders', 28
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_historical_target(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can resolve historical targets';
  END IF;

  SELECT jsonb_build_object(
    'userId', p.user_id,
    'email', p.email,
    'role', p.role,
    'status', p.status,
    'merchantId', m.id,
    'storeId', s.id,
    'storeName', s.store_name
  )
  INTO v_row
  FROM public.profiles p
  LEFT JOIN public.merchants m ON m.user_id = p.user_id
  LEFT JOIN public.stores s ON s.merchant_id = m.id
  WHERE p.user_id = p_user_id;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Target account not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_preview_historical_data(
  p_user_id uuid,
  p_categories text[],
  p_activity_level public.historical_activity_level,
  p_preset text,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target jsonb;
  v_period timestamptz[];
  v_plan jsonb;
  v_cats text[];
  v_want_orders boolean;
  v_listing_count integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can preview historical data';
  END IF;

  v_target := public.admin_resolve_historical_target(p_user_id);
  v_period := public.historical_resolve_period(p_preset, p_from, p_to);
  v_cats := coalesce(p_categories, ARRAY[]::text[]);
  IF cardinality(v_cats) = 0 THEN
    RAISE EXCEPTION 'Select at least one historical category';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_cats) AS cat
    WHERE cat NOT IN ('wallet', 'deposits', 'withdrawals', 'orders', 'viewers')
  ) THEN
    RAISE EXCEPTION 'Invalid historical category';
  END IF;

  v_plan := public.historical_activity_plan(p_activity_level);
  v_want_orders := 'orders' = ANY (v_cats);

  IF v_want_orders AND (v_target ->> 'storeId') IS NULL THEN
    RAISE EXCEPTION 'Store order history requires a merchant/store relationship';
  END IF;

  IF 'viewers' = ANY (v_cats) AND (v_target ->> 'storeId') IS NULL THEN
    RAISE EXCEPTION 'Store viewer adjustments require a store';
  END IF;

  IF ('deposits' = ANY (v_cats) OR 'withdrawals' = ANY (v_cats) OR 'wallet' = ANY (v_cats))
     AND (v_target ->> 'merchantId') IS NULL THEN
    RAISE EXCEPTION 'Wallet, deposit, and withdrawal history requires a merchant account';
  END IF;

  IF v_want_orders THEN
    SELECT count(*) INTO v_listing_count
    FROM public.merchant_product_listings mpl
    WHERE mpl.merchant_id = (v_target ->> 'merchantId')::uuid
      AND mpl.status = 'active';

    IF v_listing_count = 0 THEN
      RAISE EXCEPTION 'This merchant has no eligible products available for historical order generation.';
    END IF;
  END IF;

  PERFORM public.log_admin_action(
    'preview_historical_data',
    'profiles',
    p_user_id,
    'level=' || p_activity_level::text
  );

  RETURN jsonb_build_object(
    'status', 'preview',
    'target', v_target,
    'period', jsonb_build_object('from', v_period[1], 'to', v_period[2]),
    'categories', to_jsonb(v_cats),
    'activityLevel', p_activity_level,
    'estimated', jsonb_build_object(
      'deposits', CASE WHEN 'deposits' = ANY (v_cats) THEN (v_plan ->> 'deposits')::int + (v_plan ->> 'rejected_deposits')::int ELSE 0 END,
      'withdrawals', CASE WHEN 'withdrawals' = ANY (v_cats) THEN (v_plan ->> 'withdrawals')::int + (v_plan ->> 'rejected_withdrawals')::int ELSE 0 END,
      'orders', CASE WHEN v_want_orders THEN (v_plan ->> 'orders')::int ELSE 0 END,
      'walletTransactions', CASE
        WHEN 'wallet' = ANY (v_cats) OR 'deposits' = ANY (v_cats) OR 'orders' = ANY (v_cats) OR 'withdrawals' = ANY (v_cats)
        THEN (v_plan ->> 'deposits')::int + (v_plan ->> 'withdrawals')::int + (v_plan ->> 'orders')::int * 3
        ELSE 0
      END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_start_historical_run(
  p_user_id uuid,
  p_categories text[],
  p_activity_level public.historical_activity_level,
  p_preset text,
  p_confirm boolean,
  p_idempotency_key text,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS public.admin_historical_data_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target jsonb;
  v_period timestamptz[];
  v_run public.admin_historical_data_runs;
  v_usd public.wallets;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can generate historical data';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Generation requires explicit confirmation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.admin_historical_data_runs r
    WHERE r.target_user_id = p_user_id
      AND r.status = 'running'
  ) THEN
    RAISE EXCEPTION 'A historical generation is already running for this account';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_run
    FROM public.admin_historical_data_runs
    WHERE admin_id = auth.uid()
      AND idempotency_key = btrim(p_idempotency_key);

    IF v_run.id IS NOT NULL THEN
      IF v_run.status = 'running' THEN
        RAISE EXCEPTION 'A historical generation is already running for this account';
      END IF;

      IF v_run.status IN ('completed', 'reversed', 'preview') THEN
        RETURN v_run;
      END IF;

      IF v_run.status = 'failed' THEN
        UPDATE public.admin_historical_data_runs
        SET
          status = 'running',
          error_message = NULL,
          completed_at = NULL
        WHERE id = v_run.id
        RETURNING * INTO v_run;
        RETURN v_run;
      END IF;
    END IF;
  END IF;

  PERFORM public.admin_preview_historical_data(
    p_user_id,
    p_categories,
    p_activity_level,
    p_preset,
    p_from,
    p_to
  );

  v_target := public.admin_resolve_historical_target(p_user_id);
  v_period := public.historical_resolve_period(p_preset, p_from, p_to);

  IF (v_target ->> 'merchantId') IS NOT NULL THEN
    SELECT * INTO v_usd
    FROM public.wallets
    WHERE merchant_id = (v_target ->> 'merchantId')::uuid
      AND currency = 'USD';
  END IF;

  INSERT INTO public.admin_historical_data_runs (
    admin_id,
    target_user_id,
    merchant_id,
    store_id,
    period_from,
    period_to,
    categories,
    activity_level,
    idempotency_key,
    status,
    snapshot
  )
  VALUES (
    auth.uid(),
    p_user_id,
    NULLIF(v_target ->> 'merchantId', '')::uuid,
    NULLIF(v_target ->> 'storeId', '')::uuid,
    v_period[1],
    v_period[2],
    p_categories,
    p_activity_level,
    NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
    'running',
    jsonb_build_object(
      'usdBalance', COALESCE(v_usd.balance, 0),
      'usdWalletId', v_usd.id
    )
  )
  RETURNING * INTO v_run;

  PERFORM public.log_admin_action(
    'start_historical_data',
    'admin_historical_data_runs',
    v_run.id,
    'target=' || p_user_id::text
  );

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.historical_slot_time(
  p_seed text,
  p_n integer,
  p_from timestamptz,
  p_to timestamptz,
  p_total integer
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_from + make_interval(
    secs =>
      extract(epoch from (p_to - p_from)) *
      least(
        0.999,
        greatest(
          0.001,
          ((p_n::numeric - 0.37) / greatest(p_total, 1)::numeric)
          + (
            (public.historical_unit_rand(p_seed, p_n) - 0.5)
            * 0.42
            / greatest(p_total, 1)::numeric
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.historical_money(
  p_seed text,
  p_n integer,
  p_min numeric,
  p_span numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(p_min + (public.historical_unit_rand(p_seed, p_n) * p_span), 2);
$$;

CREATE OR REPLACE FUNCTION public.admin_fail_historical_run(
  p_run_id uuid,
  p_error text
)
RETURNS public.admin_historical_data_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.admin_historical_data_runs;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can fail historical generation runs';
  END IF;

  UPDATE public.admin_historical_data_runs
  SET
    status = 'failed',
    error_message = left(coalesce(p_error, 'Historical generation failed'), 500),
    completed_at = now()
  WHERE id = p_run_id
    AND status = 'running'
  RETURNING * INTO v_run;

  IF v_run.id IS NULL THEN
    SELECT * INTO v_run
    FROM public.admin_historical_data_runs
    WHERE id = p_run_id;

    IF v_run.id IS NULL THEN
      RAISE EXCEPTION 'Historical generation run not found';
    END IF;
  END IF;

  PERFORM public.log_admin_action(
    'fail_historical_data',
    'admin_historical_data_runs',
    v_run.id,
    left(coalesce(p_error, 'failed'), 240)
  );

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_execute_historical_run(p_run_id uuid)
RETURNS public.admin_historical_data_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.admin_historical_data_runs;
  v_plan jsonb;
  v_cats text[];
  v_usd public.wallets;
  v_crypto public.wallets;
  v_address public.admin_wallet_addresses;
  v_listing public.merchant_product_listings;
  v_variant public.product_variants;
  v_order public.orders;
  v_deposit public.wallet_deposit_requests;
  v_withdrawal public.withdrawal_requests;
  v_tx public.wallet_transactions;
  v_wallet public.wallets;
  v_at timestamptz;
  v_pay_at timestamptz;
  v_done_at timestamptz;
  v_amount numeric(36, 18);
  v_due numeric(18, 2);
  v_qty integer;
  v_status public.order_status;
  v_listing_count integer := 0;
  v_i integer;
  v_n integer;
  v_mod integer;
  v_ledger numeric(36, 18);
  v_balance numeric(36, 18);
  v_deposit_ids jsonb := '[]'::jsonb;
  v_withdrawal_ids jsonb := '[]'::jsonb;
  v_order_ids jsonb := '[]'::jsonb;
  v_tx_ids jsonb := '[]'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_approved_deposits integer := 0;
  v_rejected_deposits integer := 0;
  v_pending_deposits integer := 0;
  v_approved_withdrawals integer := 0;
  v_rejected_withdrawals integer := 0;
  v_pending_withdrawals integer := 0;
  v_orders integer := 0;
  v_usd_deposits integer := 0;
  v_viewers integer := 0;
  v_prev_viewers integer;
  v_wallet_snap jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can generate historical data';
  END IF;

  PERFORM set_config('app.suppress_notifications', 'on', true);

  SELECT * INTO v_run
  FROM public.admin_historical_data_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Historical generation run not found';
  END IF;

  IF v_run.status = 'completed' THEN
    RETURN v_run;
  END IF;

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'Historical generation run is not runnable';
  END IF;

  v_cats := v_run.categories;
  v_plan := public.historical_activity_plan(v_run.activity_level);

  IF v_run.merchant_id IS NOT NULL THEN
    SELECT jsonb_object_agg(
      w.currency::text,
      jsonb_build_object('id', w.id, 'balance', w.balance)
    )
    INTO v_wallet_snap
    FROM public.wallets w
    WHERE w.merchant_id = v_run.merchant_id;

    SELECT * INTO v_usd
    FROM public.wallets
    WHERE merchant_id = v_run.merchant_id
      AND currency = 'USD'
    FOR UPDATE;

    SELECT svs.viewer_count
    INTO v_prev_viewers
    FROM public.store_viewer_settings svs
    WHERE svs.store_id = v_run.store_id;
  END IF;

  v_run.snapshot := coalesce(v_run.snapshot, '{}'::jsonb) || jsonb_build_object(
    'wallets', coalesce(v_wallet_snap, '{}'::jsonb),
    'viewerCount', v_prev_viewers
  );

  -- Crypto deposit requests
  IF 'deposits' = ANY (v_cats) THEN
    SELECT * INTO v_address
    FROM public.admin_wallet_addresses
    WHERE status = 'active'
    ORDER BY CASE asset WHEN 'USDT' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1;

    IF v_address.id IS NULL THEN
      RAISE EXCEPTION 'No deposit address is configured. Add a deposit wallet before generating deposit history.';
    END IF;

    SELECT * INTO v_crypto
    FROM public.wallets
    WHERE merchant_id = v_run.merchant_id
      AND currency = public.crypto_asset_currency(v_address.asset)
    FOR UPDATE;

    v_n := (v_plan ->> 'deposits')::int + (v_plan ->> 'rejected_deposits')::int;
    IF v_n > 40 THEN
      RAISE EXCEPTION 'Deposit generation exceeds the configured maximum';
    END IF;

    FOR v_i IN 1..v_n LOOP
      v_amount := public.historical_money(v_run.id::text, v_i, 40, 220);
      v_at := public.historical_slot_time(
        v_run.id::text || ':dep',
        v_i,
        v_run.period_from,
        v_run.period_from + (v_run.period_to - v_run.period_from) * 0.55,
        v_n
      );

      INSERT INTO public.wallet_deposit_requests (
        merchant_id,
        asset,
        network,
        amount,
        wallet_address_id,
        wallet_address_used,
        status,
        created_at
      )
      VALUES (
        v_run.merchant_id,
        v_address.asset,
        v_address.network,
        v_amount,
        v_address.id,
        v_address.wallet_address,
        'pending',
        v_at
      )
      RETURNING * INTO v_deposit;

      v_mod := v_i % 5;
      IF v_mod = 0 THEN
        v_pending_deposits := v_pending_deposits + 1;
      ELSIF v_mod = 1 THEN
        v_deposit := public.admin_reject_deposit(v_deposit.id);
        UPDATE public.wallet_deposit_requests
        SET created_at = v_at, reviewed_at = v_at + interval '6 hours', updated_at = v_at + interval '6 hours'
        WHERE id = v_deposit.id;
        v_rejected_deposits := v_rejected_deposits + 1;
      ELSE
        v_deposit := public.admin_approve_deposit(v_deposit.id);
        UPDATE public.wallet_deposit_requests
        SET created_at = v_at, reviewed_at = v_at + interval '4 hours', updated_at = v_at + interval '4 hours'
        WHERE id = v_deposit.id;
        UPDATE public.wallet_transactions
        SET created_at = v_at + interval '4 hours', updated_at = v_at + interval '4 hours'
        WHERE reference_type = 'deposit_request'
          AND reference_id = v_deposit.id
        RETURNING * INTO v_tx;
        IF v_tx.id IS NOT NULL THEN
          v_tx_ids := v_tx_ids || jsonb_build_array(v_tx.id);
        END IF;
        v_approved_deposits := v_approved_deposits + 1;
      END IF;

      v_deposit_ids := v_deposit_ids || jsonb_build_array(v_deposit.id);
    END LOOP;
  END IF;

  -- Store orders with JIT USD funding
  IF 'orders' = ANY (v_cats) THEN
    IF v_usd.id IS NULL OR v_run.store_id IS NULL THEN
      RAISE EXCEPTION 'Store order history requires a merchant/store relationship';
    END IF;

    SELECT count(*) INTO v_listing_count
    FROM public.merchant_product_listings mpl
    JOIN public.product_variants pv
      ON pv.product_id = mpl.product_id
     AND pv.is_active = true
    WHERE mpl.merchant_id = v_run.merchant_id
      AND mpl.status = 'active';

    IF v_listing_count = 0 THEN
      RAISE EXCEPTION 'This merchant has no eligible products available for historical order generation.';
    END IF;

    v_n := (v_plan ->> 'orders')::int;
    IF v_n > 60 THEN
      RAISE EXCEPTION 'Order generation exceeds the configured maximum';
    END IF;

    FOR v_i IN 1..v_n LOOP
      SELECT mpl.*
      INTO v_listing
      FROM public.merchant_product_listings mpl
      JOIN public.product_variants pv
        ON pv.product_id = mpl.product_id
       AND pv.is_active = true
      WHERE mpl.merchant_id = v_run.merchant_id
        AND mpl.status = 'active'
      ORDER BY mpl.id, pv.id
      OFFSET (v_i - 1) % v_listing_count
      LIMIT 1;

      SELECT * INTO v_variant
      FROM public.product_variants
      WHERE product_id = v_listing.product_id
        AND is_active = true
      ORDER BY sku
      OFFSET (v_i - 1) % 3
      LIMIT 1;

      IF v_variant.id IS NULL THEN
        SELECT * INTO v_variant
        FROM public.product_variants
        WHERE product_id = v_listing.product_id
          AND is_active = true
        ORDER BY sku
        LIMIT 1;
      END IF;

      v_qty := 1 + ((v_i + 1) % 3);
      v_due := round(v_listing.wholesale_price * v_qty, 2);
      v_at := public.historical_slot_time(
        v_run.id::text || ':ord',
        v_i,
        v_run.period_from + (v_run.period_to - v_run.period_from) * 0.12,
        v_run.period_to - interval '2 days',
        v_n
      );
      IF v_at < v_run.period_from THEN
        v_at := v_run.period_from + make_interval(secs => v_i * 3600);
      END IF;
      v_pay_at := v_at + make_interval(hours => 2 + (v_i % 11));
      v_done_at := v_pay_at + make_interval(days => 1 + (v_i % 6));
      IF v_done_at > v_run.period_to THEN
        v_done_at := v_run.period_to;
      END IF;

      v_mod := v_i % 5;
      v_status := CASE v_mod
        WHEN 0 THEN 'pending'::public.order_status
        WHEN 1 THEN 'paid'::public.order_status
        WHEN 4 THEN 'cancelled'::public.order_status
        ELSE 'completed'::public.order_status
      END;

      IF v_status <> 'pending' THEN
        SELECT balance INTO v_balance
        FROM public.wallets
        WHERE id = v_usd.id;

        IF v_balance < v_due THEN
          v_amount := round((v_due - v_balance) + public.historical_money(v_run.id::text, 800 + v_i, 80, 420), 2);
          INSERT INTO public.wallet_transactions (
            wallet_id,
            type,
            amount,
            currency,
            direction,
            status,
            reference_type,
            reference_id,
            description,
            created_at
          )
          VALUES (
            v_usd.id,
            'deposit',
            v_amount,
            'USD',
            'credit',
            'completed',
            'historical_run_item',
            gen_random_uuid(),
            'Historical USD funding for selected account',
            v_at - interval '12 hours'
          )
          RETURNING * INTO v_tx;
          v_tx_ids := v_tx_ids || jsonb_build_array(v_tx.id);
          v_usd_deposits := v_usd_deposits + 1;
        END IF;
      END IF;

      INSERT INTO public.orders (
        customer_id,
        merchant_id,
        store_id,
        status,
        total_amount,
        currency,
        created_at
      )
      VALUES (
        v_run.target_user_id,
        v_run.merchant_id,
        v_run.store_id,
        'pending',
        round(v_listing.sales_price * v_qty, 2),
        'USD',
        v_at
      )
      RETURNING * INTO v_order;

      INSERT INTO public.order_items (
        order_id,
        listing_id,
        product_id,
        variant_id,
        quantity,
        sales_price,
        wholesale_price,
        created_at
      )
      VALUES (
        v_order.id,
        v_listing.id,
        v_listing.product_id,
        v_variant.id,
        v_qty,
        v_listing.sales_price,
        v_listing.wholesale_price,
        v_at
      );

      IF v_status <> 'pending' THEN
        INSERT INTO public.wallet_transactions (
          wallet_id,
          type,
          amount,
          currency,
          direction,
          status,
          reference_type,
          reference_id,
          description,
          created_at
        )
        VALUES (
          v_usd.id,
          'order_payment',
          v_due,
          'USD',
          'debit',
          'completed',
          'order',
          v_order.id,
          'Wholesale payment for order ' || v_order.id::text,
          v_pay_at
        )
        RETURNING * INTO v_tx;
        v_tx_ids := v_tx_ids || jsonb_build_array(v_tx.id);

        UPDATE public.orders
        SET status = 'paid', updated_at = v_pay_at
        WHERE id = v_order.id
        RETURNING * INTO v_order;

        IF v_status = 'cancelled' THEN
          v_order := public.cancel_order(v_order.id);
          UPDATE public.orders
          SET created_at = v_at, updated_at = v_pay_at + interval '3 hours'
          WHERE id = v_order.id;
          UPDATE public.wallet_transactions
          SET created_at = v_pay_at + interval '3 hours', updated_at = v_pay_at + interval '3 hours'
          WHERE reference_type = 'order'
            AND reference_id = v_order.id
            AND type = 'refund'
          RETURNING * INTO v_tx;
          IF v_tx.id IS NOT NULL THEN
            v_tx_ids := v_tx_ids || jsonb_build_array(v_tx.id);
          END IF;
        ELSIF v_status = 'completed' THEN
          UPDATE public.orders
          SET status = 'shipping', updated_at = v_pay_at + interval '1 day'
          WHERE id = v_order.id;

          PERFORM public.release_wholesale_settlement(v_order.id);

          UPDATE public.orders
          SET status = 'completed', created_at = v_at, updated_at = v_done_at
          WHERE id = v_order.id;

          UPDATE public.wallet_transactions
          SET created_at = v_done_at, updated_at = v_done_at
          WHERE reference_type = 'order_item'
            AND reference_id IN (SELECT oi.id FROM public.order_items oi WHERE oi.order_id = v_order.id);

          SELECT coalesce(v_tx_ids, '[]'::jsonb) || coalesce(
            (
              SELECT jsonb_agg(wt.id)
              FROM public.wallet_transactions wt
              WHERE wt.reference_type = 'order_item'
                AND wt.reference_id IN (SELECT oi.id FROM public.order_items oi WHERE oi.order_id = v_order.id)
            ),
            '[]'::jsonb
          )
          INTO v_tx_ids;
        ELSE
          UPDATE public.orders
          SET created_at = v_at, updated_at = v_pay_at
          WHERE id = v_order.id;
        END IF;
      ELSE
        UPDATE public.orders
        SET created_at = v_at, updated_at = v_at
        WHERE id = v_order.id;
      END IF;

      v_order_ids := v_order_ids || jsonb_build_array(v_order.id);
      v_orders := v_orders + 1;
    END LOOP;
  END IF;

  -- Standalone USD wallet deposits when wallet history is requested without orders
  IF 'wallet' = ANY (v_cats) AND v_usd.id IS NOT NULL AND v_usd_deposits = 0 THEN
    v_n := CASE v_run.activity_level WHEN 'low' THEN 4 WHEN 'medium' THEN 8 ELSE 12 END;
    FOR v_i IN 1..v_n LOOP
      v_amount := public.historical_money(v_run.id::text, 300 + v_i, 60, 380);
      v_at := public.historical_slot_time(
        v_run.id::text || ':usd',
        v_i,
        v_run.period_from,
        v_run.period_to,
        v_n
      );
      INSERT INTO public.wallet_transactions (
        wallet_id,
        type,
        amount,
        currency,
        direction,
        status,
        reference_type,
        reference_id,
        description,
        created_at
      )
      VALUES (
        v_usd.id,
        'deposit',
        v_amount,
        'USD',
        'credit',
        'completed',
        'historical_run_item',
        gen_random_uuid(),
        'Historical wallet deposit for selected account',
        v_at
      )
      RETURNING * INTO v_tx;
      v_tx_ids := v_tx_ids || jsonb_build_array(v_tx.id);
      v_usd_deposits := v_usd_deposits + 1;
    END LOOP;
  END IF;

  -- Crypto withdrawals after deposits / existing crypto funds
  IF 'withdrawals' = ANY (v_cats) THEN
    IF v_address.id IS NULL THEN
      SELECT * INTO v_address
      FROM public.admin_wallet_addresses
      WHERE status = 'active'
      ORDER BY CASE asset WHEN 'USDT' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1;
    END IF;

    IF v_address.id IS NULL THEN
      RAISE EXCEPTION 'No deposit address is configured. Add a deposit wallet before generating withdrawal history.';
    END IF;

    SELECT * INTO v_crypto
    FROM public.wallets
    WHERE merchant_id = v_run.merchant_id
      AND currency = public.crypto_asset_currency(v_address.asset)
    FOR UPDATE;

    v_n := (v_plan ->> 'withdrawals')::int + (v_plan ->> 'rejected_withdrawals')::int;
    IF v_n > 20 THEN
      RAISE EXCEPTION 'Withdrawal generation exceeds the configured maximum';
    END IF;

    FOR v_i IN 1..v_n LOOP
      v_amount := public.historical_money(v_run.id::text, 500 + v_i, 15, 55);
      v_at := public.historical_slot_time(
        v_run.id::text || ':wd',
        v_i,
        v_run.period_from + (v_run.period_to - v_run.period_from) * 0.4,
        v_run.period_to,
        v_n
      );
      v_mod := v_i % 4;

      SELECT balance INTO v_balance
      FROM public.wallets
      WHERE id = v_crypto.id;

      IF v_mod <> 1 AND v_mod <> 2 AND v_balance < v_amount THEN
        v_mod := 1;
      ELSIF v_mod <> 1 AND v_mod <> 2 THEN
        v_amount := least(v_amount, round(v_balance * 0.35, 2));
        IF v_amount < 10 THEN
          v_mod := 1;
        END IF;
      END IF;

      INSERT INTO public.withdrawal_requests (
        merchant_id,
        asset,
        network,
        amount,
        destination_address,
        status,
        created_at
      )
      VALUES (
        v_run.merchant_id,
        v_address.asset,
        v_address.network,
        v_amount,
        'HIST' || substr(md5(v_run.id::text || v_i::text), 1, 28),
        'pending',
        v_at
      )
      RETURNING * INTO v_withdrawal;

      IF v_mod = 1 THEN
        v_withdrawal := public.admin_reject_withdrawal(v_withdrawal.id);
        UPDATE public.withdrawal_requests
        SET created_at = v_at, reviewed_at = v_at + interval '5 hours', updated_at = v_at + interval '5 hours'
        WHERE id = v_withdrawal.id;
        v_rejected_withdrawals := v_rejected_withdrawals + 1;
      ELSIF v_mod = 2 THEN
        UPDATE public.withdrawal_requests
        SET created_at = v_at, updated_at = v_at
        WHERE id = v_withdrawal.id;
        v_pending_withdrawals := v_pending_withdrawals + 1;
      ELSE
        v_withdrawal := public.admin_approve_withdrawal(v_withdrawal.id);
        UPDATE public.withdrawal_requests
        SET created_at = v_at, reviewed_at = v_at + interval '8 hours', updated_at = v_at + interval '8 hours'
        WHERE id = v_withdrawal.id;
        UPDATE public.wallet_transactions
        SET created_at = v_at + interval '8 hours', updated_at = v_at + interval '8 hours'
        WHERE reference_type = 'withdrawal_request'
          AND reference_id = v_withdrawal.id
        RETURNING * INTO v_tx;
        v_tx_ids := v_tx_ids || jsonb_build_array(v_tx.id);
        v_approved_withdrawals := v_approved_withdrawals + 1;
      END IF;

      v_withdrawal_ids := v_withdrawal_ids || jsonb_build_array(v_withdrawal.id);
    END LOOP;
  END IF;

  IF 'viewers' = ANY (v_cats) THEN
    IF v_run.store_id IS NULL THEN
      RAISE EXCEPTION 'Store viewer history requires a store';
    END IF;

    v_viewers := CASE v_run.activity_level
      WHEN 'low' THEN 180 + (public.historical_unit_rand(v_run.id::text, 9) * 220)::int
      WHEN 'medium' THEN 740 + (public.historical_unit_rand(v_run.id::text, 9) * 680)::int
      ELSE 2400 + (public.historical_unit_rand(v_run.id::text, 9) * 2600)::int
    END;

    PERFORM public.admin_adjust_store_viewers(
      v_run.store_id,
      v_viewers,
      'Historical displayed viewer count for selected store'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id IN (
      SELECT jsonb_array_elements_text(v_order_ids)::uuid
    )
      AND (
        o.merchant_id IS DISTINCT FROM v_run.merchant_id
        OR o.store_id IS DISTINCT FROM v_run.store_id
        OR o.customer_id IS DISTINCT FROM v_run.target_user_id
      )
  ) THEN
    RAISE EXCEPTION 'Generated orders must belong to the selected account';
  END IF;

  FOR v_wallet IN
    SELECT *
    FROM public.wallets
    WHERE merchant_id = v_run.merchant_id
  LOOP
    SELECT coalesce(sum(public.wallet_transaction_delta(wt.direction, wt.amount)) FILTER (
      WHERE wt.status = 'completed'
    ), 0)
    INTO v_ledger
    FROM public.wallet_transactions wt
    WHERE wt.wallet_id = v_wallet.id;

    SELECT w.balance INTO v_balance
    FROM public.wallets w
    WHERE w.id = v_wallet.id;

    IF round(v_ledger, 8) <> round(v_balance, 8) THEN
      RAISE EXCEPTION 'Wallet accounting is inconsistent after historical generation';
    END IF;
  END LOOP;

  v_counts := jsonb_build_object(
    'deposits', v_approved_deposits + v_rejected_deposits + v_pending_deposits,
    'approvedDeposits', v_approved_deposits,
    'rejectedDeposits', v_rejected_deposits,
    'pendingDeposits', v_pending_deposits,
    'withdrawals', v_approved_withdrawals + v_rejected_withdrawals + v_pending_withdrawals,
    'approvedWithdrawals', v_approved_withdrawals,
    'rejectedWithdrawals', v_rejected_withdrawals,
    'pendingWithdrawals', v_pending_withdrawals,
    'orders', v_orders,
    'walletTransactions', jsonb_array_length(v_tx_ids),
    'usdDeposits', v_usd_deposits,
    'viewers', v_viewers
  );

  IF (
    coalesce((v_counts ->> 'deposits')::int, 0)
    + coalesce((v_counts ->> 'withdrawals')::int, 0)
    + coalesce((v_counts ->> 'orders')::int, 0)
    + coalesce((v_counts ->> 'walletTransactions')::int, 0)
  ) > 400 THEN
    RAISE EXCEPTION 'Generation exceeds the maximum number of rows per run';
  END IF;

  UPDATE public.admin_historical_data_runs
  SET
    status = 'completed',
    created_counts = v_counts,
    created_ids = jsonb_build_object(
      'deposits', v_deposit_ids,
      'withdrawals', v_withdrawal_ids,
      'orders', v_order_ids,
      'walletTransactions', v_tx_ids
    ),
    snapshot = v_run.snapshot,
    completed_at = now(),
    error_message = NULL
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  PERFORM public.log_admin_action(
    'generate_historical_data',
    'admin_historical_data_runs',
    v_run.id,
    'target=' || v_run.target_user_id::text
      || ' deposits=' || (v_counts ->> 'deposits')
      || ' orders=' || (v_counts ->> 'orders')
      || ' withdrawals=' || (v_counts ->> 'withdrawals')
  );

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reverse_historical_run(p_run_id uuid)
RETURNS public.admin_historical_data_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.admin_historical_data_runs;
  v_order public.orders;
  v_wallet public.wallets;
  v_target numeric(36, 18);
  v_delta numeric(36, 18);
  v_order_id uuid;
  v_request_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can reverse historical generation runs';
  END IF;

  SELECT * INTO v_run
  FROM public.admin_historical_data_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Historical generation run not found';
  END IF;

  IF v_run.status = 'reversed' THEN
    RETURN v_run;
  END IF;

  IF v_run.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed historical runs can be reversed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id IN (
      SELECT jsonb_array_elements_text(coalesce(v_run.created_ids -> 'orders', '[]'::jsonb))::uuid
    )
      AND o.status NOT IN ('pending', 'awaiting_payment', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'This run cannot be safely reversed because generated orders have entered the payment or fulfillment lifecycle.';
  END IF;

  IF v_run.merchant_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.wallet_transactions wt
    JOIN public.wallets w ON w.id = wt.wallet_id
    WHERE w.merchant_id = v_run.merchant_id
      AND wt.created_at > coalesce(v_run.completed_at, v_run.created_at)
      AND NOT (
        wt.id::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(v_run.created_ids -> 'walletTransactions', '[]'::jsonb))
        )
      )
  ) THEN
    RAISE EXCEPTION 'This run cannot be safely reversed because later wallet activity depends on it';
  END IF;

  IF v_run.store_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.store_id = v_run.store_id
      AND o.created_at > coalesce(v_run.completed_at, v_run.created_at)
      AND NOT (
        o.id::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(v_run.created_ids -> 'orders', '[]'::jsonb))
        )
      )
  ) THEN
    RAISE EXCEPTION 'This run cannot be safely reversed because later store orders depend on it';
  END IF;

  FOR v_order_id IN
    SELECT jsonb_array_elements_text(coalesce(v_run.created_ids -> 'orders', '[]'::jsonb))::uuid
  LOOP
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = v_order_id;

    IF v_order.status IN ('pending', 'awaiting_payment') THEN
      PERFORM public.cancel_order(v_order.id);
    END IF;
  END LOOP;

  FOR v_request_id IN
    SELECT jsonb_array_elements_text(coalesce(v_run.created_ids -> 'deposits', '[]'::jsonb))::uuid
  LOOP
    UPDATE public.wallet_deposit_requests
    SET
      status = 'rejected',
      reviewed_by = coalesce(reviewed_by, auth.uid()),
      reviewed_at = coalesce(reviewed_at, now())
    WHERE id = v_request_id
      AND status = 'pending';
  END LOOP;

  FOR v_request_id IN
    SELECT jsonb_array_elements_text(coalesce(v_run.created_ids -> 'withdrawals', '[]'::jsonb))::uuid
  LOOP
    UPDATE public.withdrawal_requests
    SET
      status = 'rejected',
      reviewed_by = coalesce(reviewed_by, auth.uid()),
      reviewed_at = coalesce(reviewed_at, now())
    WHERE id = v_request_id
      AND status IN ('pending', 'approved');
  END LOOP;

  IF v_run.merchant_id IS NOT NULL THEN
    FOR v_wallet IN
      SELECT *
      FROM public.wallets
      WHERE merchant_id = v_run.merchant_id
    LOOP
      v_target := coalesce(
        (v_run.snapshot -> 'wallets' -> v_wallet.currency::text ->> 'balance')::numeric,
        CASE WHEN v_wallet.currency = 'USD'
          THEN coalesce((v_run.snapshot ->> 'usdBalance')::numeric, v_wallet.balance)
          ELSE v_wallet.balance
        END
      );
      v_delta := round(v_wallet.balance - v_target, 8);
      IF v_delta > 0 THEN
        PERFORM public.admin_adjust_merchant_wallet(
          v_run.merchant_id,
          v_wallet.currency,
          v_delta,
          'debit',
          'Reverse historical generation ' || v_run.id::text
        );
      ELSIF v_delta < 0 THEN
        PERFORM public.admin_adjust_merchant_wallet(
          v_run.merchant_id,
          v_wallet.currency,
          abs(v_delta),
          'credit',
          'Reverse historical generation ' || v_run.id::text
        );
      END IF;
    END LOOP;
  END IF;

  IF v_run.store_id IS NOT NULL AND 'viewers' = ANY (v_run.categories) THEN
    IF v_run.snapshot ->> 'viewerCount' IS NULL THEN
      DELETE FROM public.store_viewer_settings
      WHERE store_id = v_run.store_id;
    ELSE
      PERFORM public.admin_adjust_store_viewers(
        v_run.store_id,
        (v_run.snapshot ->> 'viewerCount')::integer,
        'Reverse historical displayed viewer count'
      );
    END IF;
  END IF;

  UPDATE public.admin_historical_data_runs
  SET
    status = 'reversed',
    reversed_at = now()
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  PERFORM public.log_admin_action(
    'reverse_historical_data',
    'admin_historical_data_runs',
    v_run.id,
    'target=' || v_run.target_user_id::text
  );

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_historical_run(p_run_id uuid)
RETURNS public.admin_historical_data_runs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.admin_historical_data_runs;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can read historical generation runs';
  END IF;

  SELECT * INTO v_run
  FROM public.admin_historical_data_runs
  WHERE id = p_run_id;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Historical generation run not found';
  END IF;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_historical_runs(p_user_id uuid)
RETURNS SETOF public.admin_historical_data_runs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can list historical generation runs';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id) THEN
    RAISE EXCEPTION 'Target account not found';
  END IF;

  RETURN QUERY
  SELECT r.*
  FROM public.admin_historical_data_runs r
  WHERE r.target_user_id = p_user_id
  ORDER BY r.created_at DESC
  LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_user_historical_overview(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target jsonb;
  v_allowed text[] := ARRAY[]::text[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can view historical data options';
  END IF;

  v_target := public.admin_resolve_historical_target(p_user_id);

  IF (v_target ->> 'merchantId') IS NOT NULL THEN
    v_allowed := v_allowed || ARRAY['wallet', 'deposits', 'withdrawals'];
  END IF;

  IF (v_target ->> 'storeId') IS NOT NULL THEN
    v_allowed := v_allowed || ARRAY['orders', 'viewers'];
  END IF;

  RETURN jsonb_build_object(
    'target', v_target,
    'allowedCategories', to_jsonb(v_allowed),
    'maxDays', 180,
    'activityLevels', jsonb_build_array('low', 'medium', 'high'),
    'rangePresets', jsonb_build_array(
      'last_7_days',
      'last_30_days',
      'last_90_days',
      'last_180_days',
      'custom'
    ),
    'limits', jsonb_build_object(
      'maxDeposits', 40,
      'maxWithdrawals', 20,
      'maxOrders', 60,
      'maxWalletTransactions', 200,
      'maxTotalRows', 400
    ),
    'recentRuns', coalesce(
      (
        SELECT jsonb_agg(row_to_json(r))
        FROM (
          SELECT *
          FROM public.admin_historical_data_runs
          WHERE target_user_id = p_user_id
          ORDER BY created_at DESC
          LIMIT 10
        ) r
      ),
      '[]'::jsonb
    )
  );
END;
$$;

ALTER TABLE public.admin_historical_data_runs
  DROP CONSTRAINT IF EXISTS admin_historical_data_runs_category_values_chk;

ALTER TABLE public.admin_historical_data_runs
  ADD CONSTRAINT admin_historical_data_runs_category_values_chk
  CHECK (categories <@ ARRAY['wallet', 'deposits', 'withdrawals', 'orders', 'viewers']::text[]);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_historical_data_runs_running_target
  ON public.admin_historical_data_runs (target_user_id)
  WHERE status = 'running';

REVOKE ALL ON FUNCTION public.historical_unit_rand(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.historical_resolve_period(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.historical_activity_plan(public.historical_activity_level) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.historical_slot_time(text, integer, timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.historical_money(text, integer, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_displayed_viewer_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_store_viewers(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_historical_target(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_preview_historical_data(uuid, text[], public.historical_activity_level, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_start_historical_run(uuid, text[], public.historical_activity_level, text, boolean, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_fail_historical_run(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_execute_historical_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reverse_historical_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_historical_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_historical_runs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_historical_overview(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.store_displayed_viewer_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_store_viewers(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resolve_historical_target(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_preview_historical_data(uuid, text[], public.historical_activity_level, text, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_start_historical_run(uuid, text[], public.historical_activity_level, text, boolean, text, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_fail_historical_run(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_execute_historical_run(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reverse_historical_run(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_historical_run(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_historical_runs(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_historical_overview(uuid) TO authenticated, service_role;


