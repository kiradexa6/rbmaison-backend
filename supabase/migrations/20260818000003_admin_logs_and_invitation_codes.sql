-- R&B MAISON — admin activity logs and merchant invitation codes

CREATE TABLE public.admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  description text,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_activity_logs_action_chk CHECK (char_length(action) BETWEEN 1 AND 120),
  CONSTRAINT admin_activity_logs_target_type_chk CHECK (char_length(target_type) BETWEEN 1 AND 80)
);

CREATE INDEX idx_admin_activity_logs_admin_id ON public.admin_activity_logs (admin_id);
CREATE INDEX idx_admin_activity_logs_target ON public.admin_activity_logs (target_type, target_id);
CREATE INDEX idx_admin_activity_logs_timestamp ON public.admin_activity_logs ("timestamp" DESC);
CREATE INDEX idx_admin_activity_logs_action ON public.admin_activity_logs (action);

COMMENT ON TABLE public.admin_activity_logs IS
  'Immutable audit trail of administrative actions.';

CREATE OR REPLACE FUNCTION public.prevent_admin_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Admin activity logs are immutable';
END;
$$;

CREATE TRIGGER trg_admin_activity_logs_no_update
  BEFORE UPDATE ON public.admin_activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_log_mutation();

CREATE TRIGGER trg_admin_activity_logs_no_delete
  BEFORE DELETE ON public.admin_activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_log_mutation();

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action text,
  p_target_type text,
  p_target_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_log_id uuid;
BEGIN
  v_admin_id := auth.uid();

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only active admins can write activity logs';
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action,
    target_type,
    target_id,
    description
  )
  VALUES (
    v_admin_id,
    p_action,
    p_target_type,
    p_target_id,
    p_description
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_action(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, text) TO authenticated, service_role;

-- Auto-log admin writes on selected tables
CREATE OR REPLACE FUNCTION public.audit_admin_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_target_id uuid;
  v_actor uuid;
BEGIN
  v_actor := auth.uid();

  IF v_actor IS NULL OR NOT public.is_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_action := lower(TG_OP) || '_' || TG_TABLE_NAME;

  IF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id;
    INSERT INTO public.admin_activity_logs (
      admin_id, action, target_type, target_id, description
    )
    VALUES (
      v_actor,
      v_action,
      TG_TABLE_NAME,
      v_target_id,
      'Admin deleted ' || TG_TABLE_NAME || ' ' || v_target_id::text
    );
    RETURN OLD;
  END IF;

  v_target_id := NEW.id;
  INSERT INTO public.admin_activity_logs (
    admin_id, action, target_type, target_id, description
  )
  VALUES (
    v_actor,
    v_action,
    TG_TABLE_NAME,
    v_target_id,
    'Admin ' || lower(TG_OP) || ' on ' || TG_TABLE_NAME || ' ' || v_target_id::text
  );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Invitation codes — required for merchant registration
-- ---------------------------------------------------------------------------

CREATE TABLE public.merchant_invitation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  used_count integer NOT NULL DEFAULT 0,
  max_usage integer NOT NULL DEFAULT 1,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_invitation_codes_code_chk CHECK (char_length(code) >= 16),
  CONSTRAINT merchant_invitation_codes_usage_chk CHECK (
    max_usage >= 1 AND used_count >= 0 AND used_count <= max_usage
  )
);

CREATE INDEX idx_merchant_invitation_codes_active ON public.merchant_invitation_codes (active);
CREATE INDEX idx_merchant_invitation_codes_created_by ON public.merchant_invitation_codes (created_by);
CREATE INDEX idx_merchant_invitation_codes_expires_at ON public.merchant_invitation_codes (expires_at);

COMMENT ON TABLE public.merchant_invitation_codes IS
  'Admin-issued codes. Merchant registration is rejected without a valid unused code.';

CREATE TRIGGER trg_merchant_invitation_codes_set_updated_at
  BEFORE UPDATE ON public.merchant_invitation_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_merchant_invitation_codes_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.merchant_invitation_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_row_change();

CREATE OR REPLACE FUNCTION public.protect_invitation_code_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed';
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Invitation code value cannot be changed; deactivate and issue a new code';
  END IF;

  IF NEW.used_count < OLD.used_count THEN
    RAISE EXCEPTION 'used_count cannot decrease';
  END IF;

  -- Merchant registration consumes a code by incrementing used_count only.
  IF NEW.used_count = OLD.used_count + 1
     AND NEW.active IS NOT DISTINCT FROM OLD.active
     AND NEW.max_usage IS NOT DISTINCT FROM OLD.max_usage
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() AND NOT public.is_privileged_role() THEN
    RAISE EXCEPTION 'Only admins can manage invitation codes';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_merchant_invitation_codes_protect
  BEFORE UPDATE ON public.merchant_invitation_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_invitation_code_columns();

CREATE OR REPLACE FUNCTION public.create_merchant_invitation_code(
  p_max_usage integer DEFAULT 1,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.merchant_invitation_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.merchant_invitation_codes;
  v_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can create invitation codes';
  END IF;

  IF p_max_usage IS NULL OR p_max_usage < 1 THEN
    RAISE EXCEPTION 'max_usage must be at least 1';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at must be in the future';
  END IF;

  v_code := upper(encode(extensions.gen_random_bytes(16), 'hex'));

  INSERT INTO public.merchant_invitation_codes (
    code,
    active,
    created_by,
    used_count,
    max_usage,
    expires_at
  )
  VALUES (
    v_code,
    true,
    auth.uid(),
    0,
    p_max_usage,
    p_expires_at
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_merchant_invitation_code(integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_merchant_invitation_code(integer, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.deactivate_merchant_invitation_code(p_code_id uuid)
RETURNS public.merchant_invitation_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.merchant_invitation_codes;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can deactivate invitation codes';
  END IF;

  UPDATE public.merchant_invitation_codes
  SET active = false
  WHERE id = p_code_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Invitation code not found';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_merchant_invitation_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_merchant_invitation_code(uuid) TO authenticated, service_role;
