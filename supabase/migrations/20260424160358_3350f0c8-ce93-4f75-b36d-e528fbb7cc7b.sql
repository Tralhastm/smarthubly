
-- Tabela de sessões de carrinho (para abandono)
CREATE TABLE IF NOT EXISTS public.cart_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  abandoned_notified_at TIMESTAMPTZ,
  coupon_code TEXT,
  converted_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_sessions_tenant_phone ON public.cart_sessions(tenant_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_cart_sessions_last_activity ON public.cart_sessions(last_activity_at) WHERE converted_order_id IS NULL AND abandoned_notified_at IS NULL;

ALTER TABLE public.cart_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can upsert cart sessions" ON public.cart_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anon can update cart sessions" ON public.cart_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins read cart sessions" ON public.cart_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins delete cart sessions" ON public.cart_sessions FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_cart_sessions_updated_at BEFORE UPDATE ON public.cart_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Histórico de execuções de automações (auditoria)
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  automation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_tenant_type ON public.automation_runs(tenant_id, automation_type, ran_at DESC);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read automation runs" ON public.automation_runs FOR SELECT TO authenticated
  USING (tenant_id IS NULL AND has_platform_role(auth.uid(), 'super_admin'::platform_role)
      OR has_role(auth.uid(), 'admin'::app_role, tenant_id)
      OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "System inserts automation runs" ON public.automation_runs FOR INSERT TO authenticated WITH CHECK (true);
