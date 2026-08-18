-- R&B MAISON — profiles, auth sync, and identity helpers

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name text,
  email text NOT NULL,
  phone text,
  avatar text,
  country text,
  role public.user_role NOT NULL DEFAULT 'customer',
  status public.profile_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_email_format_chk CHECK (
    email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  CONSTRAINT profiles_phone_format_chk CHECK (
    phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'
  ),
  CONSTRAINT profiles_country_len_chk CHECK (
    country IS NULL OR char_length(country) BETWEEN 2 AND 56
  )
);

CREATE INDEX idx_profiles_role ON public.profiles (role);
CREATE INDEX idx_profiles_status ON public.profiles (status);
CREATE INDEX idx_profiles_email ON public.profiles (email);
CREATE INDEX idx_profiles_created_at ON public.profiles (created_at DESC);

COMMENT ON TABLE public.profiles IS
  'Application user profiles. Role and status cannot be changed by the subject.';

-- ---------------------------------------------------------------------------
-- Identity helpers (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
      AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_merchant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.role = 'merchant'
      AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_customer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.role = 'customer'
      AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_merchant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_profile() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_merchant() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_customer() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_profile() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Auth sync — never accept role from client metadata
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    email,
    full_name,
    role,
    status
  )
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), ''),
    'customer',
    'active'
  );

  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'customer')
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email,
        updated_at = now()
    WHERE user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.handle_auth_user_updated();

CREATE OR REPLACE FUNCTION public.sync_profile_auth_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', NEW.role::text)
  WHERE id = NEW.user_id;

  IF NEW.status IN ('suspended', 'blocked') THEN
    UPDATE auth.users
    SET banned_until = 'infinity'::timestamptz
    WHERE id = NEW.user_id;
  ELSIF NEW.status = 'active' THEN
    UPDATE auth.users
    SET banned_until = NULL
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_sync_auth
  AFTER INSERT OR UPDATE OF role, status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_auth_state();

CREATE OR REPLACE FUNCTION public.is_privileged_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(auth.role(), '') = 'service_role'
      OR current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role');
$$;

REVOKE ALL ON FUNCTION public.is_privileged_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_privileged_role() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_profile_security_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_is_admin boolean;
  v_privileged boolean;
BEGIN
  v_actor_is_admin := public.is_admin();
  v_privileged := public.is_privileged_role();

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'profiles.user_id cannot be changed';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email
     AND NOT v_actor_is_admin
     AND NOT v_privileged THEN
    IF NOT EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = NEW.user_id
        AND u.email = NEW.email
    ) THEN
      RAISE EXCEPTION 'Email must be changed through authentication, not profiles';
    END IF;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF v_actor_is_admin OR v_privileged THEN
      NULL;
    ELSIF OLD.role = 'customer'
      AND NEW.role = 'merchant'
      AND EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.user_id = NEW.user_id
      ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Role cannot be changed by the current user';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT v_actor_is_admin
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'Status cannot be changed by the current user';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_protect_security_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_security_columns();

CREATE TRIGGER trg_profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
