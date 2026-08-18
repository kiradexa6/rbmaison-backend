-- R&B MAISON — merchant wallets and append-only ledger

CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants (id) ON DELETE RESTRICT,
  currency public.supported_currency NOT NULL,
  balance numeric(36, 18) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_merchant_currency_uq UNIQUE (merchant_id, currency),
  CONSTRAINT wallets_balance_non_negative_chk CHECK (balance >= 0)
);

CREATE INDEX idx_wallets_merchant_id ON public.wallets (merchant_id);
CREATE INDEX idx_wallets_currency ON public.wallets (currency);

COMMENT ON TABLE public.wallets IS
  'Cached wallet balances. The ledger in wallet_transactions is the source of truth; balance cannot be written directly.';

CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets (id) ON DELETE RESTRICT,
  type public.wallet_transaction_type NOT NULL,
  amount numeric(36, 18) NOT NULL,
  currency public.supported_currency NOT NULL,
  direction public.wallet_transaction_direction NOT NULL,
  status public.wallet_transaction_status NOT NULL DEFAULT 'pending',
  reference_type text,
  reference_id uuid,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_amount_positive_chk CHECK (amount > 0),
  CONSTRAINT wallet_transactions_direction_consistency_chk CHECK (
    (type IN ('deposit', 'order_payment', 'profit_release') AND direction = 'credit')
    OR (type IN ('withdrawal', 'refund') AND direction = 'debit')
    OR (type = 'admin_adjustment')
  ),
  CONSTRAINT wallet_transactions_reference_chk CHECK (
    (reference_type IS NULL AND reference_id IS NULL)
    OR (reference_type IS NOT NULL AND char_length(reference_type) BETWEEN 1 AND 80)
  )
);

CREATE INDEX idx_wallet_transactions_wallet_id ON public.wallet_transactions (wallet_id);
CREATE INDEX idx_wallet_transactions_status ON public.wallet_transactions (status);
CREATE INDEX idx_wallet_transactions_type ON public.wallet_transactions (type);
CREATE INDEX idx_wallet_transactions_created_at ON public.wallet_transactions (created_at DESC);
CREATE INDEX idx_wallet_transactions_reference ON public.wallet_transactions (reference_type, reference_id);

CREATE UNIQUE INDEX uq_wallet_transactions_open_reference
  ON public.wallet_transactions (wallet_id, type, reference_type, reference_id)
  WHERE reference_id IS NOT NULL
    AND status IN ('pending', 'completed');

COMMENT ON TABLE public.wallet_transactions IS
  'Append-only financial ledger. Completed rows cannot be edited or deleted; corrections require a reversing transaction.';

CREATE OR REPLACE FUNCTION public.wallet_transaction_delta(
  p_direction public.wallet_transaction_direction,
  p_amount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_direction = 'credit' THEN p_amount
    WHEN p_direction = 'debit' THEN -p_amount
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.protect_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'wallets.merchant_id cannot be changed';
  END IF;

  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'wallets.currency cannot be changed';
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'Wallet balance can only change through ledger transactions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wallets_protect
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_wallet_balance();

CREATE TRIGGER trg_wallets_set_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.apply_wallet_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_delta numeric(36, 18);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ledger transactions cannot be deleted';
  END IF;

  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be greater than zero';
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE id = NEW.wallet_id
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_wallet.currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'Transaction currency must match wallet currency';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.direction IS DISTINCT FROM OLD.direction
       OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
       OR NEW.reference_id IS DISTINCT FROM OLD.reference_id THEN
      RAISE EXCEPTION 'Ledger transaction fields are immutable';
    END IF;

    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'Completed ledger transactions cannot be modified';
    END IF;

    IF OLD.status IN ('failed', 'cancelled')
       AND NEW.status = 'completed' THEN
      RAISE EXCEPTION 'Terminal transactions cannot be completed';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.status = 'completed')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    v_delta := public.wallet_transaction_delta(NEW.direction, NEW.amount);

    IF v_wallet.balance + v_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient wallet balance';
    END IF;

    UPDATE public.wallets
    SET balance = balance + v_delta
    WHERE id = NEW.wallet_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wallet_transactions_ledger
  BEFORE INSERT OR UPDATE OR DELETE ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_wallet_ledger();

CREATE TRIGGER trg_wallet_transactions_set_updated_at
  BEFORE UPDATE ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_wallets_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE TRIGGER trg_wallet_transactions_audit
  AFTER INSERT OR UPDATE ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE OR REPLACE FUNCTION public.create_merchant_wallets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.wallets (merchant_id, currency, balance)
  VALUES
    (NEW.id, 'USD', 0),
    (NEW.id, 'BTC', 0),
    (NEW.id, 'ETH', 0),
    (NEW.id, 'USDT', 0);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_merchants_create_wallets
  AFTER INSERT ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.create_merchant_wallets();

CREATE OR REPLACE FUNCTION public.resolve_transaction_direction(
  p_type public.wallet_transaction_type,
  p_direction public.wallet_transaction_direction
)
RETURNS public.wallet_transaction_direction
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_type IN ('deposit', 'order_payment', 'profit_release') THEN
    RETURN 'credit';
  END IF;

  IF p_type IN ('withdrawal', 'refund') THEN
    RETURN 'debit';
  END IF;

  IF p_direction IS NULL THEN
    RAISE EXCEPTION 'direction is required for admin_adjustment';
  END IF;

  RETURN p_direction;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_wallet_transaction(
  p_wallet_id uuid,
  p_type public.wallet_transaction_type,
  p_amount numeric,
  p_status public.wallet_transaction_status DEFAULT 'completed',
  p_direction public.wallet_transaction_direction DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.wallet_transactions;
  v_currency public.supported_currency;
  v_direction public.wallet_transaction_direction;
BEGIN
  IF auth.uid() IS NULL AND NOT public.is_privileged_role() THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_admin() AND NOT public.is_privileged_role() THEN
    RAISE EXCEPTION 'Only admins can record wallet transactions';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT currency INTO v_currency
  FROM public.wallets
  WHERE id = p_wallet_id;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_direction := public.resolve_transaction_direction(p_type, p_direction);

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
    p_wallet_id,
    p_type,
    p_amount,
    v_currency,
    v_direction,
    p_status,
    p_reference_type,
    p_reference_id,
    p_description
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_wallet_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets;
  v_row public.wallet_transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id
    AND merchant_id = public.current_merchant_id();

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for the current merchant';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF v_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id,
    type,
    amount,
    currency,
    direction,
    status,
    description
  )
  VALUES (
    v_wallet.id,
    'withdrawal',
    p_amount,
    v_wallet.currency,
    'debit',
    'pending',
    p_description
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_wallet_transaction(
  p_transaction_id uuid,
  p_status public.wallet_transaction_status
)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.wallet_transactions;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_privileged_role() THEN
    RAISE EXCEPTION 'Only admins can finalize wallet transactions';
  END IF;

  IF p_status NOT IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid terminal status';
  END IF;

  UPDATE public.wallet_transactions
  SET status = p_status
  WHERE id = p_transaction_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_transaction_delta(public.wallet_transaction_direction, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_transaction_direction(public.wallet_transaction_type, public.wallet_transaction_direction) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_wallet_transaction(uuid, public.wallet_transaction_type, numeric, public.wallet_transaction_status, public.wallet_transaction_direction, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_withdrawal(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_wallet_transaction(uuid, public.wallet_transaction_status) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_wallet_transaction(uuid, public.wallet_transaction_type, numeric, public.wallet_transaction_status, public.wallet_transaction_direction, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_wallet_transaction(uuid, public.wallet_transaction_status) TO authenticated, service_role;
