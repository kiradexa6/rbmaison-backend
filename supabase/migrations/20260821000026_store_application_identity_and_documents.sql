-- Store application identity fields, private document storage, and extended submit RPC.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'application-documents',
    'application-documents',
    false,
    10485760,
    ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    ]
  )
ON CONFLICT (id) DO NOTHING;

CREATE POLICY storage_application_documents_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'application-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY storage_application_documents_select_own_or_admin
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'application-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

CREATE POLICY storage_application_documents_delete_own_or_admin
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'application-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

ALTER TABLE public.merchant_applications
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS identity_document_type text,
  ADD COLUMN IF NOT EXISTS logo text;

ALTER TABLE public.merchant_applications
  DROP CONSTRAINT IF EXISTS merchant_applications_phone_chk;

ALTER TABLE public.merchant_applications
  ADD CONSTRAINT merchant_applications_phone_chk CHECK (
    phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'
  );

ALTER TABLE public.merchant_applications
  DROP CONSTRAINT IF EXISTS merchant_applications_identity_document_type_chk;

ALTER TABLE public.merchant_applications
  ADD CONSTRAINT merchant_applications_identity_document_type_chk CHECK (
    identity_document_type IS NULL
    OR identity_document_type IN ('passport', 'national_id')
  );

ALTER TABLE public.merchant_applications
  DROP CONSTRAINT IF EXISTS merchant_applications_address_chk;

ALTER TABLE public.merchant_applications
  ADD CONSTRAINT merchant_applications_address_chk CHECK (
    address IS NULL OR char_length(btrim(address)) BETWEEN 5 AND 500
  );

CREATE OR REPLACE FUNCTION public.submit_merchant_application(
  p_store_name text,
  p_business_description text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_documents jsonb DEFAULT '[]'::jsonb,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_identity_document_type text DEFAULT NULL,
  p_logo text DEFAULT NULL
)
RETURNS public.merchant_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles;
  v_row public.merchant_applications;
  v_country text;
  v_docs jsonb;
  v_phone text;
  v_address text;
  v_identity text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  IF v_profile.role <> 'customer' THEN
    RAISE EXCEPTION 'Only customers can apply for a store';
  END IF;

  IF EXISTS (SELECT 1 FROM public.merchants WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'A merchant account already exists for this user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_applications
    WHERE user_id = v_user_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending store application already exists';
  END IF;

  IF char_length(btrim(COALESCE(p_store_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Store name is required';
  END IF;

  v_country := btrim(COALESCE(p_country, v_profile.country, ''));
  IF char_length(v_country) < 2 THEN
    RAISE EXCEPTION 'Country is required';
  END IF;

  v_phone := NULLIF(btrim(COALESCE(p_phone, v_profile.phone, '')), '');
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'Phone number is invalid';
  END IF;

  v_address := NULLIF(btrim(COALESCE(p_address, '')), '');
  IF v_address IS NOT NULL AND char_length(v_address) < 5 THEN
    RAISE EXCEPTION 'Address is required';
  END IF;

  v_identity := NULLIF(btrim(COALESCE(p_identity_document_type, '')), '');
  IF v_identity IS NOT NULL AND v_identity NOT IN ('passport', 'national_id') THEN
    RAISE EXCEPTION 'Identity document type must be passport or national_id';
  END IF;

  v_docs := COALESCE(p_documents, '[]'::jsonb);
  IF jsonb_typeof(v_docs) <> 'array' THEN
    RAISE EXCEPTION 'Documents must be a JSON array';
  END IF;

  IF v_identity = 'passport' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_docs) AS doc
      WHERE doc ->> 'kind' = 'passport'
    ) THEN
      RAISE EXCEPTION 'Passport document is required';
    END IF;
  ELSIF v_identity = 'national_id' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_docs) AS doc
      WHERE doc ->> 'kind' = 'national_id_front'
    ) OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_docs) AS doc
      WHERE doc ->> 'kind' = 'national_id_back'
    ) THEN
      RAISE EXCEPTION 'National ID front and back documents are required';
    END IF;
  END IF;

  IF v_phone IS NOT NULL AND v_profile.phone IS DISTINCT FROM v_phone THEN
    UPDATE public.profiles
    SET phone = v_phone,
        updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  IF v_country IS NOT NULL AND v_profile.country IS DISTINCT FROM v_country THEN
    UPDATE public.profiles
    SET country = v_country,
        updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  INSERT INTO public.merchant_applications (
    user_id,
    store_name,
    business_description,
    country,
    documents,
    phone,
    address,
    identity_document_type,
    logo,
    status
  )
  VALUES (
    v_user_id,
    btrim(p_store_name),
    NULLIF(btrim(COALESCE(p_business_description, '')), ''),
    v_country,
    v_docs,
    v_phone,
    v_address,
    v_identity,
    NULLIF(btrim(COALESCE(p_logo, '')), ''),
    'pending'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_merchant_store(
  p_store_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_logo text DEFAULT NULL
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.stores;
BEGIN
  IF public.current_merchant_id() IS NULL THEN
    RAISE EXCEPTION 'Only merchants can update their store';
  END IF;

  SELECT * INTO v_store
  FROM public.stores
  WHERE merchant_id = public.current_merchant_id()
  FOR UPDATE;

  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  UPDATE public.stores
  SET
    store_name = COALESCE(NULLIF(btrim(p_store_name), ''), store_name),
    description = CASE
      WHEN p_description IS NULL THEN description
      ELSE NULLIF(btrim(p_description), '')
    END,
    logo = CASE
      WHEN p_logo IS NULL THEN logo
      ELSE NULLIF(btrim(p_logo), '')
    END,
    updated_at = now()
  WHERE id = v_store.id
  RETURNING * INTO v_store;

  IF p_store_name IS NOT NULL AND btrim(p_store_name) <> '' THEN
    UPDATE public.merchants
    SET store_name = btrim(p_store_name),
        updated_at = now()
    WHERE id = v_store.merchant_id;
  END IF;

  RETURN v_store;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_merchant_application(text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_merchant_store(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_merchant_application(text, text, text, jsonb, text, text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_merchant_store(text, text, text)
  TO authenticated, service_role;
