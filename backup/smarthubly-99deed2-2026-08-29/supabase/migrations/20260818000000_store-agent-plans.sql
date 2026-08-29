-- Sofia Agente de Loja: tabela de planos revisáveis (plano → aprovação → aplicação → rollback)
CREATE TABLE IF NOT EXISTS public.store_agent_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_request TEXT NOT NULL,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_before JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_after JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rolled_back', 'failed')),
  applied_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_store_agent_plans_tenant ON public.store_agent_plans(tenant_id, created_at DESC);

-- Somente admin da loja (ou super admin) lê/aplica planos da própria loja
DROP POLICY IF EXISTS "Agent plans: tenant admins manage own" ON public.store_agent_plans;
CREATE POLICY "Agent plans: tenant admins manage own"
  ON public.store_agent_plans FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );
