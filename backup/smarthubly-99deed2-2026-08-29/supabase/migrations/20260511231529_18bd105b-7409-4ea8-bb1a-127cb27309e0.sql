
-- ============================================================
-- COMANDAS DE MESA (Modo Garçom)
-- ============================================================

-- Token de acesso do garçom por tenant
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS waiter_access_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  ADD COLUMN IF NOT EXISTS tables_enabled boolean NOT NULL DEFAULT false;

-- Mesas
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  code text NOT NULL DEFAULT encode(extensions.gen_random_bytes(8), 'hex'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, label),
  UNIQUE(code)
);
CREATE INDEX IF NOT EXISTS idx_tables_tenant ON public.restaurant_tables(tenant_id);

-- Comanda virtual (sessão por mesa)
CREATE TABLE IF NOT EXISTS public.table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
  table_label text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open', -- open | sent | paid | cancelled
  total numeric(10,2) NOT NULL DEFAULT 0,
  order_id uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_table_sessions_tenant ON public.table_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_table ON public.table_sessions(table_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_open ON public.table_sessions(tenant_id, status) WHERE status = 'open';

-- Itens da comanda (antes de virar pedido)
CREATE TABLE IF NOT EXISTS public.table_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  product_id uuid,
  product_name text NOT NULL,
  product_price numeric(10,2) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  variant_name text,
  addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  added_by text NOT NULL DEFAULT 'customer', -- customer | waiter
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_table_items_session ON public.table_session_items(session_id);

-- Liga pedido à mesa
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS table_session_id uuid,
  ADD COLUMN IF NOT EXISTS table_label text;
CREATE INDEX IF NOT EXISTS idx_orders_table_session ON public.orders(table_session_id);

-- RLS
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_session_items ENABLE ROW LEVEL SECURITY;

-- restaurant_tables: admins gerenciam; público lê (pra resolver code do QR)
CREATE POLICY "Admins manage tables" ON public.restaurant_tables FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Anyone reads tables" ON public.restaurant_tables FOR SELECT TO anon, authenticated USING (true);

-- table_sessions: público pode ler/criar/atualizar (cliente abre via QR; garçom usa token)
CREATE POLICY "Anyone read sessions" ON public.table_sessions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone insert sessions" ON public.table_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone update open sessions" ON public.table_sessions FOR UPDATE TO anon, authenticated
  USING (status IN ('open','sent')) WITH CHECK (true);
CREATE POLICY "Admins delete sessions" ON public.table_sessions FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- table_session_items: público insere/lê; admin gerencia
CREATE POLICY "Anyone read items" ON public.table_session_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone insert items" ON public.table_session_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone delete items in open session" ON public.table_session_items FOR DELETE TO anon, authenticated
  USING (EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id = session_id AND s.status = 'open'));
CREATE POLICY "Anyone update items in open session" ON public.table_session_items FOR UPDATE TO anon, authenticated
  USING (EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id = session_id AND s.status = 'open'))
  WITH CHECK (true);

-- Trigger updated_at
CREATE TRIGGER trg_tables_updated BEFORE UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_table_sessions_updated BEFORE UPDATE ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.table_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.table_session_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_tables;
