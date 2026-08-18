BEGIN;

SELECT plan(7);

SELECT has_function('public', 'merchant_store_orders', 'merchant store orders exists');
SELECT has_function('public', 'confirm_merchant_order', 'confirm merchant order exists');
SELECT has_function('public', 'merchant_send_for_shipping', 'send for shipping exists');
SELECT has_function('public', 'admin_complete_merchant_order', 'admin complete exists');
SELECT has_function('public', 'release_wholesale_settlement', 'wholesale settlement exists');
SELECT has_function('public', 'admin_merchant_orders', 'admin merchant orders exists');
SELECT has_function('public', 'order_is_settled', 'settlement idempotency helper exists');

SELECT * FROM finish();

ROLLBACK;
