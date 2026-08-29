
-- =============== Função de relatórios operacionais ===============
CREATE OR REPLACE FUNCTION public.get_operational_reports(
  _tenant_id UUID,
  _from TIMESTAMPTZ,
  _to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_by_hour JSONB;
  v_by_dow JSONB;
  v_product_mix JSONB;
  v_waiter_perf JSONB;
  v_avg_ticket NUMERIC;
  v_total_orders INTEGER;
  v_total_revenue NUMERIC;
BEGIN
  -- Totais
  SELECT COUNT(*), COALESCE(SUM(total),0), COALESCE(AVG(total),0)
    INTO v_total_orders, v_total_revenue, v_avg_ticket
    FROM public.orders
    WHERE tenant_id = _tenant_id AND status = 'delivered'
      AND created_at >= _from AND created_at <= _to;

  -- Ticket médio e contagem por hora do dia (0-23)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'hour', h, 'orders', n, 'revenue', rev, 'avg_ticket', avg_t
  ) ORDER BY h), '[]'::jsonb) INTO v_by_hour
  FROM (
    SELECT EXTRACT(HOUR FROM created_at)::int AS h,
           COUNT(*) AS n,
           COALESCE(SUM(total),0) AS rev,
           COALESCE(AVG(total),0) AS avg_t
      FROM public.orders
     WHERE tenant_id = _tenant_id AND status = 'delivered'
       AND created_at >= _from AND created_at <= _to
     GROUP BY EXTRACT(HOUR FROM created_at)
  ) t;

  -- Por dia da semana (0=dom..6=sab)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'dow', d, 'orders', n, 'revenue', rev
  ) ORDER BY d), '[]'::jsonb) INTO v_by_dow
  FROM (
    SELECT EXTRACT(DOW FROM created_at)::int AS d,
           COUNT(*) AS n,
           COALESCE(SUM(total),0) AS rev
      FROM public.orders
     WHERE tenant_id = _tenant_id AND status = 'delivered'
       AND created_at >= _from AND created_at <= _to
     GROUP BY EXTRACT(DOW FROM created_at)
  ) t;

  -- Mix de produtos (top 20)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_name', name, 'qty', qty, 'revenue', rev
  ) ORDER BY qty DESC), '[]'::jsonb) INTO v_product_mix
  FROM (
    SELECT COALESCE(oi.name, 'Item') AS name,
           SUM(oi.quantity)::numeric AS qty,
           SUM(oi.quantity * oi.unit_price)::numeric AS rev
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.tenant_id = _tenant_id AND o.status = 'delivered'
       AND o.created_at >= _from AND o.created_at <= _to
     GROUP BY oi.name
     ORDER BY qty DESC
     LIMIT 20
  ) p;

  -- Performance por garçom
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'waiter_id', wid, 'waiter_name', wname, 'orders', n, 'revenue', rev, 'avg_ticket', avg_t
  ) ORDER BY rev DESC), '[]'::jsonb) INTO v_waiter_perf
  FROM (
    SELECT ts.assigned_waiter_id AS wid,
           COALESCE(ts.assigned_waiter_name, 'Sem garçom') AS wname,
           COUNT(o.id) AS n,
           COALESCE(SUM(o.total),0) AS rev,
           COALESCE(AVG(o.total),0) AS avg_t
      FROM public.orders o
      LEFT JOIN public.table_sessions ts ON ts.id = o.table_session_id
     WHERE o.tenant_id = _tenant_id AND o.status = 'delivered'
       AND o.created_at >= _from AND o.created_at <= _to
       AND ts.assigned_waiter_id IS NOT NULL
     GROUP BY ts.assigned_waiter_id, ts.assigned_waiter_name
  ) w;

  RETURN jsonb_build_object(
    'total_orders', v_total_orders,
    'total_revenue', v_total_revenue,
    'avg_ticket', v_avg_ticket,
    'by_hour', v_by_hour,
    'by_dow', v_by_dow,
    'product_mix', v_product_mix,
    'waiter_performance', v_waiter_perf
  );
END;
$$;

-- =============== Tabela de chamados de suporte ===============
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal', -- low, normal, high, urgent
  status TEXT NOT NULL DEFAULT 'open',     -- open, in_progress, waiting_customer, resolved, closed
  category TEXT,                           -- bug, feature, billing, training, other
  contact_email TEXT,
  contact_phone TEXT,
  created_by UUID,
  assigned_to UUID,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_tenant ON public.support_tickets(tenant_id, status, created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_admin_all" ON public.support_tickets FOR ALL
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_support_updated_at BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============== Mensagens dentro do ticket ===============
CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL, -- 'customer' | 'support'
  sender_name TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_msg_ticket ON public.support_messages(ticket_id, created_at);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sup_msg_admin_all" ON public.support_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.support_tickets t
                  WHERE t.id = ticket_id
                    AND (public.has_role(auth.uid(), 'admin', t.tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.support_tickets t
                       WHERE t.id = ticket_id
                         AND (public.has_role(auth.uid(), 'admin', t.tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'))));
