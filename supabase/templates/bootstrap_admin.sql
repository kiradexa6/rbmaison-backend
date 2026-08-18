-- R&B MAISON — bootstrap the first admin
--
-- This is NOT mock data. It promotes a real Auth user that already exists.
--
-- Steps:
-- 1. In Supabase Dashboard → Authentication → Users → Add user
--    (or sign up through the app with the admin email).
-- 2. Replace ADMIN_EMAIL_HERE below with that exact email.
-- 3. Run this script in SQL Editor as postgres (Dashboard SQL editor).
--
-- Do not put this file in automatic seed pipelines.

DO $$
DECLARE
  v_email text := 'ADMIN_EMAIL_HERE';
  v_user_id uuid;
BEGIN
  IF v_email = 'ADMIN_EMAIL_HERE' OR v_email IS NULL OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'Replace ADMIN_EMAIL_HERE with the real admin email before running';
  END IF;

  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user found for %. Create the user in Authentication first.', v_email;
  END IF;

  UPDATE public.profiles
  SET role = 'admin',
      status = 'active'
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile row missing for %. Confirm the handle_new_user trigger ran.', v_email;
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'admin'),
      banned_until = NULL
  WHERE id = v_user_id;

  RAISE NOTICE 'Promoted % to admin (user_id=%)', v_email, v_user_id;
END;
$$;
