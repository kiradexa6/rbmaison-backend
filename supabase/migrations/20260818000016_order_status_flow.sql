-- Additive order statuses for merchant payment and shipping flow.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'awaiting_payment';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'shipping';
