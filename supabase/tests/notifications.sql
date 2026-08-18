-- Optional pgTAP checks for the notification system.
BEGIN;

SELECT plan(10);

SELECT has_table('public', 'notifications', 'notifications table exists');
SELECT has_type('public', 'notification_type', 'notification type enum exists');
SELECT has_function('public', 'create_notification', 'create_notification RPC exists');
SELECT has_function('public', 'notify_admins', 'notify_admins RPC exists');
SELECT has_function('public', 'my_notifications', 'my_notifications RPC exists');
SELECT has_function('public', 'notification_unread_count', 'unread count RPC exists');
SELECT has_function('public', 'mark_notification_read', 'mark read RPC exists');
SELECT has_function('public', 'mark_all_notifications_read', 'mark all read RPC exists');
SELECT has_function('public', 'notify_order_payment_required', 'payment required RPC exists');
SELECT has_function('public', 'order_notification_payload', 'order payload helper exists');

SELECT * FROM finish();

ROLLBACK;
