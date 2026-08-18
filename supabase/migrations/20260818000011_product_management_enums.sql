-- R&B MAISON — catalogue enum extensions
-- New values are added here and used in the following migration
-- (PostgreSQL cannot use a newly added enum value in the same transaction).

ALTER TYPE public.product_status ADD VALUE IF NOT EXISTS 'inactive';

CREATE TYPE public.product_gender AS ENUM ('women', 'men', 'unisex');

CREATE TYPE public.brand_status AS ENUM ('active', 'inactive');

CREATE TYPE public.inventory_transaction_type AS ENUM (
  'stock_added',
  'stock_removed',
  'order_reserved',
  'order_released',
  'adjustment'
);
