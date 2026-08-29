
CREATE OR REPLACE FUNCTION public.safe_uuid(txt text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN txt::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END; $$;

DROP POLICY IF EXISTS "Tenant admins upload own product images" ON storage.objects;
CREATE POLICY "Tenant admins upload own product images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (
      public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
      OR (
        public.safe_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND public.has_role(auth.uid(), 'admin'::app_role, public.safe_uuid((storage.foldername(name))[1]))
      )
    )
  );

DROP POLICY IF EXISTS "Tenant admins update own product images" ON storage.objects;
CREATE POLICY "Tenant admins update own product images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
      OR (
        public.safe_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND public.has_role(auth.uid(), 'admin'::app_role, public.safe_uuid((storage.foldername(name))[1]))
      )
    )
  );

DROP POLICY IF EXISTS "Tenant admins delete own product images" ON storage.objects;
CREATE POLICY "Tenant admins delete own product images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
      OR (
        public.safe_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND public.has_role(auth.uid(), 'admin'::app_role, public.safe_uuid((storage.foldername(name))[1]))
      )
    )
  );
