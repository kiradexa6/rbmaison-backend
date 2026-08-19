BEGIN;

SELECT plan(14);

SELECT has_function('public', 'admin_preview_historical_data', 'preview historical data exists');
SELECT has_function('public', 'admin_start_historical_run', 'start historical run exists');
SELECT has_function('public', 'admin_execute_historical_run', 'execute historical run exists');
SELECT has_function('public', 'admin_fail_historical_run', 'fail historical run exists');
SELECT has_function('public', 'admin_reverse_historical_run', 'reverse historical run exists');
SELECT has_function('public', 'admin_list_historical_runs', 'list historical runs exists');
SELECT has_function('public', 'admin_get_historical_run', 'get historical run exists');
SELECT has_function('public', 'admin_user_historical_overview', 'historical overview exists');
SELECT has_function('public', 'admin_adjust_store_viewers', 'adjust store viewers exists');
SELECT has_function('public', 'store_displayed_viewer_count', 'displayed viewer count exists');
SELECT has_table('public', 'admin_historical_data_runs', 'historical run table exists');
SELECT has_table('public', 'store_viewer_settings', 'store viewer settings table exists');
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'create_notification'
      AND pg_get_functiondef(oid) ILIKE '%app.suppress_notifications%'
  ),
  'notification creation can be suppressed during generation'
);

SELECT * FROM finish();

ROLLBACK;
