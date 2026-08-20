-- Historical Records Control Center:
-- enrich processed counts (profits/payments/billing) from created wallet txs
-- duplicate-run guard for overlapping completed history on the same account
-- include the selected user's name on the historical target payload

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
    'id', p.user_id,
    'name', p.full_name,
    'fullName', p.full_name,
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

CREATE OR REPLACE FUNCTION public.admin_enrich_historical_run_counts(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.admin_historical_data_runs;
  v_tx_ids uuid[] := ARRAY[]::uuid[];
  v_profits integer := 0;
  v_payments integer := 0;
  v_billing integer := 0;
  v_counts jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can view historical generation results';
  END IF;

  SELECT * INTO v_run
  FROM public.admin_historical_data_runs
  WHERE id = p_run_id;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Historical generation run not found';
  END IF;

  SELECT coalesce(array_agg(value::uuid), ARRAY[]::uuid[])
  INTO v_tx_ids
  FROM jsonb_array_elements_text(coalesce(v_run.created_ids -> 'walletTransactions', '[]'::jsonb)) AS value;

  IF cardinality(v_tx_ids) > 0 THEN
    SELECT
      count(*) FILTER (WHERE wt.type = 'profit_release')::integer,
      count(*) FILTER (WHERE wt.type = 'order_payment')::integer,
      count(*)::integer
    INTO v_profits, v_payments, v_billing
    FROM public.wallet_transactions wt
    WHERE wt.id = ANY (v_tx_ids);
  END IF;

  v_counts := coalesce(v_run.created_counts, '{}'::jsonb) || jsonb_build_object(
    'profits', v_profits,
    'payments', v_payments,
    'billing', v_billing
  );

  UPDATE public.admin_historical_data_runs
  SET created_counts = v_counts
  WHERE id = v_run.id;

  RETURN v_counts;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enrich_historical_run_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_enrich_historical_run_counts(uuid) TO authenticated, service_role;

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
  v_existing public.admin_historical_data_runs;
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

  SELECT * INTO v_existing
  FROM public.admin_historical_data_runs r
  WHERE r.target_user_id = p_user_id
    AND r.status = 'completed'
    AND r.reversed_at IS NULL
    AND r.categories @> p_categories
    AND p_categories @> r.categories
  ORDER BY r.completed_at DESC NULLS LAST
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.admin_historical_data_runs r
    WHERE r.target_user_id = p_user_id
      AND r.status = 'completed'
      AND r.reversed_at IS NULL
      AND r.categories && p_categories
  ) THEN
    RAISE EXCEPTION 'Historical records already exist for this account. Reverse the previous run before generating overlapping history.';
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
