-- pgTAP: production hardening
BEGIN;

SELECT plan(4);

SELECT has_function('public', 'protect_order_mutations', 'order mutation guard exists');
SELECT has_function('public', 'protect_listing_columns', 'listing column guard exists');
SELECT has_table('public', 'wallets', 'wallets table exists');
SELECT has_table('public', 'notifications', 'notifications table exists');

SELECT * FROM finish();

ROLLBACK;
