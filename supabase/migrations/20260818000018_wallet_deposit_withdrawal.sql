-- R&B MAISON — admin deposit addresses, merchant top-up, and withdrawals
-- Balances still change only through wallet_transactions.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

CREATE TYPE public.crypto_asset AS ENUM ('BTC', 'ETH', 'USDT');

CREATE TYPE public.wallet_network AS ENUM (
  'bitcoin',
  'ethereum',
  'erc20',
  'trc20',
  'bep20'
);

CREATE TYPE public.wallet_address_status AS ENUM ('active', 'disabled');

CREATE TYPE public.deposit_request_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE public.withdrawal_request_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'completed'
);

CREATE OR REPLACE FUNCTION public.wallet_network_matches_asset(
  p_asset public.crypto_asset,
  p_network public.wallet_network
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (p_asset = 'BTC' AND p_network = 'bitcoin')
    OR (p_asset = 'ETH' AND p_network = 'ethereum')
    OR (p_asset = 'USDT' AND p_network IN ('erc20', 'trc20', 'bep20'));
$$;

CREATE OR REPLACE FUNCTION public.crypto_asset_currency(p_asset public.crypto_asset)
RETURNS public.supported_currency
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_asset::text::public.supported_currency;
$$;

-- ---------------------------------------------------------------------------
-- Admin deposit addresses
-- ---------------------------------------------------------------------------

CREATE TABLE public.admin_wallet_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset public.crypto_asset NOT NULL,
  network public.wallet_network NOT NULL,
  wallet_address text NOT NULL,
  status public.wallet_address_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_wallet_addresses_address_chk CHECK (
    char_length(btrim(wallet_address)) BETWEEN 8 AND 128
  ),
  CONSTRAINT admin_wallet_addresses_network_chk CHECK (
    public.wallet_network_matches_asset(asset, network)
  )
);

CREATE UNIQUE INDEX uq_admin_wallet_addresses_active_address
  ON public.admin_wallet_addresses (asset, network, lower(btrim(wallet_address)))
  WHERE status = 'active';

CREATE INDEX idx_admin_wallet_addresses_asset_network
  ON public.admin_wallet_addresses (asset, network, status);

COMMENT ON TABLE public.admin_wallet_addresses IS
  'Admin-controlled deposit destinations. Disabled rows are hidden from merchants.';

-- ---------------------------------------------------------------------------
-- Deposit / withdrawal requests
-- ---------------------------------------------------------------------------

CREATE TABLE public.wallet_deposit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants (id) ON DELETE RESTRICT,
  asset public.crypto_asset NOT NULL,
  network public.wallet_network NOT NULL,
  amount numeric(36, 18) NOT NULL,
  wallet_address_id uuid REFERENCES public.admin_wallet_addresses (id) ON DELETE SET NULL,
  wallet_address_used text NOT NULL,
  status public.deposit_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  CONSTRAINT wallet_deposit_requests_amount_chk CHECK (amount > 0),
  CONSTRAINT wallet_deposit_requests_network_chk CHECK (
    public.wallet_network_matches_asset(asset, network)
  ),
  CONSTRAINT wallet_deposit_requests_review_chk CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX idx_wallet_deposit_requests_merchant_id ON public.wallet_deposit_requests (merchant_id);
CREATE INDEX idx_wallet_deposit_requests_status ON public.wallet_deposit_requests (status);
CREATE INDEX idx_wallet_deposit_requests_created_at ON public.wallet_deposit_requests (created_at DESC);

CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants (id) ON DELETE RESTRICT,
  asset public.crypto_asset NOT NULL,
  network public.wallet_network NOT NULL,
  amount numeric(36, 18) NOT NULL,
  destination_address text NOT NULL,
  status public.withdrawal_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  CONSTRAINT withdrawal_requests_amount_chk CHECK (amount > 0),
  CONSTRAINT withdrawal_requests_network_chk CHECK (
    public.wallet_network_matches_asset(asset, network)
  ),
  CONSTRAINT withdrawal_requests_destination_chk CHECK (
    char_length(btrim(destination_address)) BETWEEN 8 AND 128
  ),
  CONSTRAINT withdrawal_requests_review_chk CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX idx_withdrawal_requests_merchant_id ON public.withdrawal_requests (merchant_id);
CREATE INDEX idx_withdrawal_requests_status ON public.withdrawal_requests (status);
CREATE INDEX idx_withdrawal_requests_created_at ON public.withdrawal_requests (created_at DESC);

COMMENT ON TABLE public.wallet_deposit_requests IS
  'Merchant top-up claims. Balance increases only after admin approval writes a deposit ledger row.';

COMMENT ON TABLE public.withdrawal_requests IS
  'Merchant withdrawal claims. Funds are not reserved on submit; they debit only when an admin approves.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_admin_wallet_addresses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can manage deposit wallet addresses';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.wallet_address := btrim(NEW.wallet_address);
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed';
  END IF;

  NEW.wallet_address := btrim(NEW.wallet_address);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admin_wallet_addresses_protect
  BEFORE INSERT OR UPDATE ON public.admin_wallet_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_admin_wallet_addresses();

CREATE TRIGGER trg_admin_wallet_addresses_set_updated_at
  BEFORE UPDATE ON public.admin_wallet_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_admin_wallet_addresses_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_wallet_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE OR REPLACE FUNCTION public.protect_deposit_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Wallet requests cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
       OR NEW.asset IS DISTINCT FROM OLD.asset
       OR NEW.network IS DISTINCT FROM OLD.network
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.wallet_address_used IS DISTINCT FROM OLD.wallet_address_used THEN
      RAISE EXCEPTION 'Wallet request commercial fields are immutable';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can review wallet requests';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_withdrawal_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Wallet requests cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
       OR NEW.asset IS DISTINCT FROM OLD.asset
       OR NEW.network IS DISTINCT FROM OLD.network
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.destination_address IS DISTINCT FROM OLD.destination_address THEN
      RAISE EXCEPTION 'Wallet request commercial fields are immutable';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can review wallet requests';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wallet_deposit_requests_protect
  BEFORE UPDATE OR DELETE ON public.wallet_deposit_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_deposit_requests();

CREATE TRIGGER trg_withdrawal_requests_protect
  BEFORE UPDATE OR DELETE ON public.withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_withdrawal_requests();

CREATE TRIGGER trg_wallet_deposit_requests_set_updated_at
  BEFORE UPDATE ON public.wallet_deposit_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_withdrawal_requests_set_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_wallet_deposit_requests_audit
  AFTER INSERT OR UPDATE ON public.wallet_deposit_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_withdrawal_requests_audit
  AFTER INSERT OR UPDATE ON public.withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_wallet_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_wallet_addresses_select
  ON public.admin_wallet_addresses
  FOR SELECT
  TO authenticated
  USING (status = 'active' OR public.is_admin());

CREATE POLICY admin_wallet_addresses_admin_write
  ON public.admin_wallet_addresses
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY wallet_deposit_requests_select
  ON public.wallet_deposit_requests
  FOR SELECT
  TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.is_admin());

CREATE POLICY withdrawal_requests_select
  ON public.withdrawal_requests
  FOR SELECT
  TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.is_admin());

-- Writes go through SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- Admin address RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_add_wallet_address(
  p_asset public.crypto_asset,
  p_network public.wallet_network,
  p_wallet_address text
)
RETURNS public.admin_wallet_addresses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_wallet_addresses;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can add deposit wallets';
  END IF;

  INSERT INTO public.admin_wallet_addresses (
    asset,
    network,
    wallet_address,
    status,
    created_by
  )
  VALUES (
    p_asset,
    p_network,
    btrim(p_wallet_address),
    'active',
    auth.uid()
  )
  RETURNING * INTO v_row;

  PERFORM public.log_admin_action(
    'add_wallet_address',
    'admin_wallet_addresses',
    v_row.id,
    v_row.asset::text || '/' || v_row.network::text
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_wallet_address(
  p_id uuid,
  p_wallet_address text DEFAULT NULL,
  p_network public.wallet_network DEFAULT NULL
)
RETURNS public.admin_wallet_addresses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_wallet_addresses;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can edit deposit wallets';
  END IF;

  UPDATE public.admin_wallet_addresses
  SET
    wallet_address = COALESCE(NULLIF(btrim(p_wallet_address), ''), wallet_address),
    network = COALESCE(p_network, network)
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Wallet address not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_wallet_address_status(
  p_id uuid,
  p_status public.wallet_address_status
)
RETURNS public.admin_wallet_addresses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_wallet_addresses;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change deposit wallet status';
  END IF;

  UPDATE public.admin_wallet_addresses
  SET status = p_status
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Wallet address not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_wallet_address(p_id uuid)
RETURNS public.admin_wallet_addresses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_wallet_addresses;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete deposit wallets';
  END IF;

  DELETE FROM public.admin_wallet_addresses
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Wallet address not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.merchant_deposit_addresses(
  p_asset public.crypto_asset,
  p_network public.wallet_network
)
RETURNS SETOF public.admin_wallet_addresses
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF public.current_merchant_id() IS NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only merchants can view deposit addresses';
  END IF;

  IF NOT public.wallet_network_matches_asset(p_asset, p_network) THEN
    RAISE EXCEPTION 'Network is not valid for this asset';
  END IF;

  RETURN QUERY
  SELECT a.*
  FROM public.admin_wallet_addresses a
  WHERE a.asset = p_asset
    AND a.network = p_network
    AND a.status = 'active'
  ORDER BY a.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- Deposit requests
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_deposit_request(
  p_amount numeric,
  p_asset public.crypto_asset,
  p_network public.wallet_network
)
RETURNS public.wallet_deposit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_address public.admin_wallet_addresses;
  v_row public.wallet_deposit_requests;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can create deposit requests';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF NOT public.wallet_network_matches_asset(p_asset, p_network) THEN
    RAISE EXCEPTION 'Network is not valid for this asset';
  END IF;

  SELECT * INTO v_address
  FROM public.admin_wallet_addresses
  WHERE asset = p_asset
    AND network = p_network
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_address.id IS NULL THEN
    RAISE EXCEPTION 'No deposit address available for this asset and network';
  END IF;

  INSERT INTO public.wallet_deposit_requests (
    merchant_id,
    asset,
    network,
    amount,
    wallet_address_id,
    wallet_address_used,
    status
  )
  VALUES (
    v_merchant_id,
    p_asset,
    p_network,
    p_amount,
    v_address.id,
    v_address.wallet_address,
    'pending'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_deposits(
  p_status public.deposit_request_status DEFAULT NULL,
  p_store_id uuid DEFAULT NULL,
  p_merchant_query text DEFAULT NULL
)
RETURNS TABLE (
  request_id uuid,
  merchant_id uuid,
  store_id uuid,
  store_name text,
  merchant_name text,
  amount numeric,
  asset public.crypto_asset,
  network public.wallet_network,
  wallet_address_used text,
  status public.deposit_request_status,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search deposits';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    m.id,
    m.store_id,
    COALESCE(s.store_name, m.store_name),
    COALESCE(p.full_name, m.store_name),
    r.amount,
    r.asset,
    r.network,
    r.wallet_address_used,
    r.status,
    r.created_at
  FROM public.wallet_deposit_requests r
  JOIN public.merchants m ON m.id = r.merchant_id
  LEFT JOIN public.stores s ON s.id = m.store_id
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE (p_status IS NULL OR r.status = p_status)
    AND (p_store_id IS NULL OR m.store_id = p_store_id)
    AND (
      p_merchant_query IS NULL
      OR btrim(p_merchant_query) = ''
      OR m.store_name ILIKE '%' || btrim(p_merchant_query) || '%'
      OR p.full_name ILIKE '%' || btrim(p_merchant_query) || '%'
    )
  ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_deposit(p_request_id uuid)
RETURNS public.wallet_deposit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.wallet_deposit_requests;
  v_wallet public.wallets;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve deposits';
  END IF;

  SELECT * INTO v_request
  FROM public.wallet_deposit_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Deposit request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Deposit request is not pending';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = v_request.merchant_id
    AND currency = public.crypto_asset_currency(v_request.asset)
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Merchant wallet not found for this asset';
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id,
    type,
    amount,
    currency,
    direction,
    status,
    reference_type,
    reference_id,
    description
  )
  VALUES (
    v_wallet.id,
    'deposit',
    v_request.amount,
    v_wallet.currency,
    'credit',
    'completed',
    'deposit_request',
    v_request.id,
    'Approved deposit ' || v_request.id::text
  );

  UPDATE public.wallet_deposit_requests
  SET
    status = 'approved',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  PERFORM public.log_admin_action(
    'approve_deposit',
    'wallet_deposit_requests',
    v_request.id,
    v_request.asset::text || ' ' || v_request.amount::text
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_deposit(p_request_id uuid)
RETURNS public.wallet_deposit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.wallet_deposit_requests;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject deposits';
  END IF;

  UPDATE public.wallet_deposit_requests
  SET
    status = 'rejected',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = p_request_id
    AND status = 'pending'
  RETURNING * INTO v_request;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Deposit request not found';
  END IF;

  PERFORM public.log_admin_action(
    'reject_deposit',
    'wallet_deposit_requests',
    v_request.id,
    NULL
  );

  RETURN v_request;
END;
$$;

-- ---------------------------------------------------------------------------
-- Withdrawal requests
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_withdrawal_request(
  p_asset public.crypto_asset,
  p_network public.wallet_network,
  p_amount numeric,
  p_destination_address text
)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
  v_wallet public.wallets;
  v_row public.withdrawal_requests;
BEGIN
  v_merchant_id := public.current_merchant_id();

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Only merchants can request withdrawals';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF NOT public.wallet_network_matches_asset(p_asset, p_network) THEN
    RAISE EXCEPTION 'Network is not valid for this asset';
  END IF;

  IF char_length(btrim(COALESCE(p_destination_address, ''))) < 8 THEN
    RAISE EXCEPTION 'Destination wallet address is required';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = v_merchant_id
    AND currency = public.crypto_asset_currency(p_asset);

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Merchant wallet not found for this asset';
  END IF;

  IF v_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance.';
  END IF;

  INSERT INTO public.withdrawal_requests (
    merchant_id,
    asset,
    network,
    amount,
    destination_address,
    status
  )
  VALUES (
    v_merchant_id,
    p_asset,
    p_network,
    p_amount,
    btrim(p_destination_address),
    'pending'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_withdrawals(
  p_status public.withdrawal_request_status DEFAULT NULL,
  p_store_id uuid DEFAULT NULL,
  p_merchant_query text DEFAULT NULL
)
RETURNS TABLE (
  request_id uuid,
  merchant_id uuid,
  store_id uuid,
  store_name text,
  merchant_name text,
  amount numeric,
  asset public.crypto_asset,
  network public.wallet_network,
  destination_address text,
  status public.withdrawal_request_status,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can search withdrawals';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    m.id,
    m.store_id,
    COALESCE(s.store_name, m.store_name),
    COALESCE(p.full_name, m.store_name),
    r.amount,
    r.asset,
    r.network,
    r.destination_address,
    r.status,
    r.created_at
  FROM public.withdrawal_requests r
  JOIN public.merchants m ON m.id = r.merchant_id
  LEFT JOIN public.stores s ON s.id = m.store_id
  JOIN public.profiles p ON p.user_id = m.user_id
  WHERE (p_status IS NULL OR r.status = p_status)
    AND (p_store_id IS NULL OR m.store_id = p_store_id)
    AND (
      p_merchant_query IS NULL
      OR btrim(p_merchant_query) = ''
      OR m.store_name ILIKE '%' || btrim(p_merchant_query) || '%'
      OR p.full_name ILIKE '%' || btrim(p_merchant_query) || '%'
    )
  ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(p_request_id uuid)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.withdrawal_requests;
  v_wallet public.wallets;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve withdrawals';
  END IF;

  SELECT * INTO v_request
  FROM public.withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Withdrawal request is not pending';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = v_request.merchant_id
    AND currency = public.crypto_asset_currency(v_request.asset)
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Merchant wallet not found for this asset';
  END IF;

  IF v_wallet.balance < v_request.amount THEN
    RAISE EXCEPTION 'Insufficient balance.';
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id,
    type,
    amount,
    currency,
    direction,
    status,
    reference_type,
    reference_id,
    description
  )
  VALUES (
    v_wallet.id,
    'withdrawal',
    v_request.amount,
    v_wallet.currency,
    'debit',
    'completed',
    'withdrawal_request',
    v_request.id,
    'Approved withdrawal ' || v_request.id::text
  );

  UPDATE public.withdrawal_requests
  SET
    status = 'completed',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  PERFORM public.log_admin_action(
    'approve_withdrawal',
    'withdrawal_requests',
    v_request.id,
    v_request.asset::text || ' ' || v_request.amount::text
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(p_request_id uuid)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.withdrawal_requests;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject withdrawals';
  END IF;

  UPDATE public.withdrawal_requests
  SET
    status = 'rejected',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = p_request_id
    AND status = 'pending'
  RETURNING * INTO v_request;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;

  PERFORM public.log_admin_action(
    'reject_withdrawal',
    'withdrawal_requests',
    v_request.id,
    NULL
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_merchant_wallet(
  p_merchant_id uuid,
  p_currency public.supported_currency,
  p_amount numeric,
  p_direction public.wallet_transaction_direction,
  p_reason text
)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can adjust merchant balances';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Direction must be credit or debit';
  END IF;

  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reason is required for balance adjustments';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = p_merchant_id
    AND currency = p_currency
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Merchant wallet not found';
  END IF;

  IF p_direction = 'debit' AND v_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance.';
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id,
    type,
    amount,
    currency,
    direction,
    status,
    reference_type,
    description
  )
  VALUES (
    v_wallet.id,
    'admin_adjustment',
    p_amount,
    v_wallet.currency,
    p_direction,
    'completed',
    'admin_adjustment',
    btrim(p_reason)
  )
  RETURNING * INTO v_tx;

  PERFORM public.log_admin_action(
    CASE WHEN p_direction = 'credit' THEN 'add_funds' ELSE 'remove_funds' END,
    'wallets',
    v_wallet.id,
    p_reason
  );

  RETURN v_tx;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_network_matches_asset(public.crypto_asset, public.wallet_network) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crypto_asset_currency(public.crypto_asset) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_wallet_address(public.crypto_asset, public.wallet_network, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_wallet_address(uuid, text, public.wallet_network) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_wallet_address_status(uuid, public.wallet_address_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_wallet_address(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_deposit_addresses(public.crypto_asset, public.wallet_network) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_deposit_request(numeric, public.crypto_asset, public.wallet_network) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_deposits(public.deposit_request_status, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_approve_deposit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_deposit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_withdrawal_request(public.crypto_asset, public.wallet_network, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_withdrawals(public.withdrawal_request_status, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_approve_withdrawal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_merchant_wallet(uuid, public.supported_currency, numeric, public.wallet_transaction_direction, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.wallet_network_matches_asset(public.crypto_asset, public.wallet_network) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_wallet_address(public.crypto_asset, public.wallet_network, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_wallet_address(uuid, text, public.wallet_network) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_wallet_address_status(uuid, public.wallet_address_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_wallet_address(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_deposit_addresses(public.crypto_asset, public.wallet_network) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_deposit_request(numeric, public.crypto_asset, public.wallet_network) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_deposits(public.deposit_request_status, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_deposit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_deposit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_request(public.crypto_asset, public.wallet_network, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_withdrawals(public.withdrawal_request_status, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_withdrawal(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_merchant_wallet(uuid, public.supported_currency, numeric, public.wallet_transaction_direction, text) TO authenticated, service_role;
