
-- Tabela de garçons (vários por loja)
CREATE TABLE IF NOT EXISTS public.waiters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  access_token TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waiters_tenant ON public.waiters(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiters_token ON public.waiters(access_token);

ALTER TABLE public.waiters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage waiters" ON public.waiters FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role,tenant_id) OR has_platform_role(auth.uid(),'super_admin'::platform_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role,tenant_id) OR has_platform_role(auth.uid(),'super_admin'::platform_role));

CREATE POLICY "Anyone can read active waiters" ON public.waiters FOR SELECT TO anon, authenticated USING (active = true);

CREATE TRIGGER trg_waiters_updated_at BEFORE UPDATE ON public.waiters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Garçom sorteado na sessão
ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS assigned_waiter_id UUID;
ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS assigned_waiter_name TEXT;

-- Chamados de atendimento
CREATE TABLE IF NOT EXISTS public.service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL,
  table_id UUID NOT NULL,
  table_label TEXT NOT NULL,
  waiter_id UUID,
  customer_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',  -- open | resolved | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_srq_tenant_status ON public.service_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_srq_session ON public.service_requests(session_id);

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create service request" ON public.service_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can read service requests" ON public.service_requests FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can update service requests" ON public.service_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins delete service requests" ON public.service_requests FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role,tenant_id) OR has_platform_role(auth.uid(),'super_admin'::platform_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.service_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.waiters;
