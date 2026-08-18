-- Additive listing status for wholesale remove/re-list.
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'removed';
