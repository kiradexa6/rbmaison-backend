-- Optional pgTAP checks for merchant wholesale flow.
-- Run with: npx supabase test db

BEGIN;

SELECT plan(10);

SELECT has_column('public', 'merchants', 'wholesale_enabled', 'wholesale access flag exists');
SELECT has_column('public', 'merchant_product_listings', 'sales_price_snapshot', 'sales price snapshot exists');
SELECT has_function('public', 'preview_merchant_listing', 'listing preview RPC exists');
SELECT has_function('public', 'create_merchant_listing', 'listing create RPC exists');
SELECT has_function('public', 'remove_merchant_listing', 'listing remove RPC exists');
SELECT has_function('public', 'merchant_wholesale_catalog', 'wholesale catalog RPC exists');
SELECT has_function('public', 'merchant_listed_products', 'merchant product management RPC exists');
SELECT has_function('public', 'merchant_store_profile', 'merchant store profile RPC exists');
SELECT has_function('public', 'admin_search_merchants', 'admin merchant search RPC exists');
SELECT has_function('public', 'admin_search_listings', 'admin listing search RPC exists');

SELECT * FROM finish();

ROLLBACK;
