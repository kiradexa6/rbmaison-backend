-- Optional pgTAP checks for order payment and fulfillment.
BEGIN;

SELECT plan(8);

SELECT has_column('public', 'order_items', 'listing_id', 'order items link to merchant listings');
SELECT has_function('public', 'place_order', 'place order RPC exists');
SELECT has_function('public', 'confirm_merchant_order', 'merchant confirm RPC exists');
SELECT has_function('public', 'merchant_go_for_shipping', 'go for shipping RPC exists');
SELECT has_function('public', 'admin_confirm_delivery', 'admin delivery RPC exists');
SELECT has_function('public', 'cancel_order', 'cancel order RPC exists');
SELECT has_function('public', 'merchant_store_orders', 'store orders RPC exists');
SELECT has_function('public', 'admin_search_orders', 'admin order search RPC exists');

SELECT * FROM finish();

ROLLBACK;
