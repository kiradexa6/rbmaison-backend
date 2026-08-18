-- Optional pgTAP checks for product management RLS.
-- Run with: npx supabase test db
-- These assertions require a linked local database; Jest covers service-level behaviour.

BEGIN;

SELECT plan(6);

SELECT has_table('public', 'inventory_transactions', 'inventory ledger exists');
SELECT has_column('public', 'products', 'published', 'products.published exists');
SELECT has_column('public', 'inventory', 'reserved_quantity', 'reserved stock exists');
SELECT has_column('public', 'inventory', 'available_quantity', 'available stock exists');
SELECT has_function('public', 'search_catalogue', 'public catalogue search exists');
SELECT has_function('public', 'create_merchant_listing', 'merchant listing RPC exists');

SELECT * FROM finish();

ROLLBACK;
