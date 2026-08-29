-- Fix: automation_suggestions INSERT must be tenant-scoped
DROP POLICY IF EXISTS "System inserts suggestions" ON public.automation_suggestions;
CREATE POLICY "Admins insert suggestions"
  ON public.automation_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

-- Fix: catalog_backups INSERT must be tenant-scoped
DROP POLICY IF EXISTS "System inserts backups" ON public.catalog_backups;
CREATE POLICY "Admins insert backups"
  ON public.catalog_backups FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

-- Fix: storage product-images INSERT must check tenant folder ownership
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
CREATE POLICY "Tenant admins upload own product images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (
      has_role(auth.uid(), 'admin'::app_role, ((storage.foldername(name))[1])::uuid)
      OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
    )
  );