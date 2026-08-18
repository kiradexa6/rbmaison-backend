-- R&B MAISON — extensions, enumerations, and shared trigger functions

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

CREATE TYPE public.user_role AS ENUM ('customer', 'merchant', 'admin');

CREATE TYPE public.profile_status AS ENUM (
  'active',
  'suspended',
  'blocked',
  'pending'
);

CREATE TYPE public.verification_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE public.merchant_status AS ENUM (
  'active',
  'suspended',
  'blocked'
);

CREATE TYPE public.store_status AS ENUM (
  'pending',
  'active',
  'suspended'
);

CREATE TYPE public.supported_currency AS ENUM ('USD', 'BTC', 'ETH', 'USDT');

CREATE TYPE public.wallet_transaction_type AS ENUM (
  'deposit',
  'withdrawal',
  'order_payment',
  'admin_adjustment',
  'refund',
  'profit_release'
);

CREATE TYPE public.wallet_transaction_status AS ENUM (
  'pending',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE public.wallet_transaction_direction AS ENUM ('credit', 'debit');

CREATE TYPE public.product_status AS ENUM ('draft', 'active', 'archived');

CREATE TYPE public.listing_status AS ENUM (
  'pending',
  'active',
  'suspended',
  'inactive'
);

CREATE TYPE public.order_status AS ENUM (
  'pending',
  'confirmed',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Maintains updated_at on row modification.';
