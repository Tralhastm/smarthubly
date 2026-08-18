-- Multi-tenant para prospecção: tenant_id + RLS para admins de tenant
-- NULL = leads do super admin (globais); tenant_id preenchido = leads do lojista.

-- 1) Garantir coluna tenant_id nas duas tabelas
ALTER TABLE public.remote_prospects
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE public.street_prospects
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_remote_prospects_tenant ON public.remote_prospects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_street_prospects_tenant ON public.street_prospects(tenant_id);

-- 2) Remover políticas antigas (somente super admin) e recriar com suporte multi-tenant
DROP POLICY IF EXISTS "Super admins manage street prospects" ON public.street_prospects;
DROP POLICY IF EXISTS "super admins read remote_prospects" ON public.remote_prospects;
DROP POLICY IF EXISTS "super admins insert remote_prospects" ON public.remote_prospects;
DROP POLICY IF EXISTS "super admins update remote_prospects" ON public.remote_prospects;
DROP POLICY IF EXISTS "super admins delete remote_prospects" ON public.remote_prospects;

-- Helper local: admin de tenant = user_roles approved admin
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_user_id uuid, p_tenant_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND tenant_id = p_tenant_id
      AND role = 'admin'
      AND approved = true
  );
$$;

-- 3) remote_prospects
CREATE POLICY "super_admin full remote_prospects"
  ON public.remote_prospects FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "tenant_admin read own remote_prospects"
  ON public.remote_prospects FOR SELECT TO authenticated
  USING (
    public.is_tenant_admin(auth.uid(), tenant_id)
  );

CREATE POLICY "tenant_admin write own remote_prospects"
  ON public.remote_prospects FOR ALL TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

-- 4) street_prospects
CREATE POLICY "super_admin full street_prospects"
  ON public.street_prospects FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "tenant_admin read own street_prospects"
  ON public.street_prospects FOR SELECT TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY "tenant_admin write own street_prospects"
  ON public.street_prospects FOR ALL TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));
