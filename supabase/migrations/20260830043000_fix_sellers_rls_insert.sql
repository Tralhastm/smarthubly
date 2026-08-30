-- Corrige o cadastro de vendedores: uma política FOR ALL precisa de WITH CHECK
-- explícito para INSERT (USING sozinho não autoriza novas linhas).
DROP POLICY IF EXISTS sellers_tenant_access ON public.sellers;

CREATE POLICY sellers_tenant_access
  ON public.sellers
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );
