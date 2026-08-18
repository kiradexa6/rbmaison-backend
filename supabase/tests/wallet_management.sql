BEGIN;

SELECT plan(8);

SELECT has_table('public', 'admin_wallet_addresses', 'admin deposit addresses exist');
SELECT has_table('public', 'wallet_deposit_requests', 'deposit requests exist');
SELECT has_table('public', 'withdrawal_requests', 'withdrawal requests exist');
SELECT has_function('public', 'admin_add_wallet_address', 'add wallet RPC exists');
SELECT has_function('public', 'create_deposit_request', 'deposit request RPC exists');
SELECT has_function('public', 'admin_approve_deposit', 'approve deposit RPC exists');
SELECT has_function('public', 'create_withdrawal_request', 'withdrawal request RPC exists');
SELECT has_function('public', 'admin_approve_withdrawal', 'approve withdrawal RPC exists');

SELECT * FROM finish();

ROLLBACK;
