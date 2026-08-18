-- R&B MAISON — Supabase Storage buckets and object policies

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    true,
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'store-logos',
    'store-logos',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'product-images',
    'product-images',
    true,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
ON CONFLICT (id) DO NOTHING;

-- Public read (CDN / storefront)
CREATE POLICY storage_avatars_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY storage_store_logos_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'store-logos');

CREATE POLICY storage_product_images_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'product-images');

-- Avatars: {user_id}/...
CREATE POLICY storage_avatars_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY storage_avatars_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY storage_avatars_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- Store logos: {merchant_id}/...
CREATE POLICY storage_store_logos_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'store-logos'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = public.current_merchant_id()::text
    )
  );

CREATE POLICY storage_store_logos_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'store-logos'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = public.current_merchant_id()::text
    )
  )
  WITH CHECK (
    bucket_id = 'store-logos'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = public.current_merchant_id()::text
    )
  );

CREATE POLICY storage_store_logos_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'store-logos'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = public.current_merchant_id()::text
    )
  );

-- Product images: admin only writes
CREATE POLICY storage_product_images_admin_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_admin()
  );

CREATE POLICY storage_product_images_admin_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

CREATE POLICY storage_product_images_admin_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin());
