-- Optional pgTAP checks for admin control center / merchant applications.
-- Run with: npx supabase test db

BEGIN;

SELECT plan(16);

SELECT has_table('public', 'merchant_applications', 'merchant applications table exists');
SELECT has_table('public', 'merchant_credit_scores', 'merchant credit scores table exists');
SELECT has_table('public', 'store_followers', 'store followers table exists');
SELECT has_type('public', 'merchant_application_status', 'application status enum exists');
SELECT has_function('public', 'submit_merchant_application', 'customer application RPC exists');
SELECT has_function('public', 'admin_approve_merchant_application', 'admin approve RPC exists');
SELECT has_function('public', 'admin_reject_merchant_application', 'admin reject RPC exists');
SELECT has_function('public', 'admin_search_users', 'admin user search RPC exists');
SELECT has_function('public', 'admin_search_stores', 'admin store search RPC exists');
SELECT has_function('public', 'shop_details', 'shop details RPC exists');
SELECT has_function('public', 'shop_statistics', 'shop statistics RPC exists');
SELECT has_function('public', 'shop_financials', 'shop financials RPC exists');
SELECT has_function('public', 'admin_adjust_store_wallet', 'store balance adjustment RPC exists');
SELECT has_function('public', 'admin_adjust_credit_score', 'credit adjustment RPC exists');
SELECT has_function('public', 'admin_set_store_status', 'store status RPC exists');
SELECT has_function('public', 'admin_search_activity_logs', 'admin activity log RPC exists');

SELECT * FROM finish();

ROLLBACK;
