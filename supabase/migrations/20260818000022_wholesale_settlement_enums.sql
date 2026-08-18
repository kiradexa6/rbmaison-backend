-- R&B MAISON — wholesale settlement enums
-- Must commit before functions in 00023 use the new labels.

ALTER TYPE public.wallet_transaction_type ADD VALUE IF NOT EXISTS 'wholesale_return';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'completed';
