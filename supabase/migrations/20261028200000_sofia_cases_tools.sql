ALTER TABLE public.sofia_knowledge_registry ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE public.sofia_knowledge_registry ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 0.8000;
ALTER TABLE public.sofia_knowledge_registry ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'documented';
ALTER TABLE public.sofia_knowledge_registry ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.sofia_knowledge_registry ADD COLUMN IF NOT EXISTS successful_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.sofia_knowledge_registry ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE public.sofia_knowledge_registry ADD COLUMN IF NOT EXISTS sharing_scope TEXT NOT NULL DEFAULT 'platform';

CREATE TABLE IF NOT EXISTS public.sofia_tool_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  purpose TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  permission TEXT NOT NULL,
  tenant_scope TEXT NOT NULL DEFAULT 'current_tenant',
  impact TEXT NOT NULL DEFAULT 'read_only',
  requires_confirmation BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  version TEXT NOT NULL DEFAULT '1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sofia_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  surface TEXT NOT NULL,
  situation TEXT NOT NULL,
  allowed_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  problem TEXT NOT NULL,
  diagnosis TEXT,
  action_taken TEXT,
  responsible TEXT,
  result TEXT,
  resolution_seconds INTEGER,
  impact TEXT,
  evaluation TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  system_version TEXT,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
  sharing_scope TEXT NOT NULL DEFAULT 'private_tenant',
  status TEXT NOT NULL DEFAULT 'needs_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sofia_knowledge_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  title TEXT NOT NULL,
  proposal TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sofia_tool_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_knowledge_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage Sofia tools" ON public.sofia_tool_registry FOR ALL TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role)) WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Super admins manage Sofia cases" ON public.sofia_cases FOR ALL TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role)) WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Super admins manage Sofia suggestions" ON public.sofia_knowledge_suggestions FOR ALL TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role)) WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
INSERT INTO public.sofia_tool_registry (name,label,purpose,parameters,permission,tenant_scope,impact,requires_confirmation)
VALUES
('read_store_context','Consultar loja','Lê configurações e catálogo da loja atual.','{"tenantId":"uuid"}','tenant_admin_or_super_admin','current_tenant','read_only',false),
('list_recent_orders','Listar pedidos','Consulta pedidos recentes e seus status para a loja autorizada.','{"tenantId":"uuid","limit":"integer"}','tenant_admin_or_super_admin','current_tenant','read_only',false),
('get_order_context','Consultar pedido','Consulta um pedido específico e seus dados operacionais.','{"orderId":"uuid","tenantId":"uuid"}','tenant_admin_or_super_admin','current_tenant','read_only',false),
('explain_feature','Explicar função','Explica onde fica uma função usando conhecimento documentado e fonte real.','{"question":"string"}','authenticated','current_tenant','read_only',false),
('draft_support_reply','Rascunhar resposta','Gera resposta de atendimento sem enviar compromisso externo.','{"conversation":"array"}','authenticated','current_tenant','communication_draft',false),
('apply_store_agent_plan','Aplicar plano','Aplica mudanças da Sofia Agente com snapshot/rollback.','{"planId":"uuid"}','tenant_admin_or_super_admin','current_tenant','write_store',true)
ON CONFLICT (name) DO NOTHING;
