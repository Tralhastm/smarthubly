
-- Onda 2: comanda individual por pessoa, comissão por garçom, curva ABC

-- 1. Comanda individual (tab por pessoa)
ALTER TABLE public.table_session_items ADD COLUMN IF NOT EXISTS tab_label TEXT DEFAULT '';
ALTER TABLE public.table_session_payments ADD COLUMN IF NOT EXISTS tab_label TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tsi_session_tab ON public.table_session_items(session_id, tab_label);
CREATE INDEX IF NOT EXISTS idx_tsp_session_tab ON public.table_session_payments(session_id, tab_label);

-- 2. Comissão por garçom
ALTER TABLE public.waiters ADD COLUMN IF NOT EXISTS commission_percent NUMERIC NOT NULL DEFAULT 0;

-- RPC: tabs de uma sessão (cada pessoa)
CREATE OR REPLACE FUNCTION public.get_session_tabs(_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  WITH labels AS (
    SELECT DISTINCT COALESCE(NULLIF(tab_label,''),'Geral') AS tab FROM public.table_session_items WHERE session_id = _session_id
    UNION
    SELECT DISTINCT COALESCE(NULLIF(tab_label,''),'Geral') FROM public.table_session_payments WHERE session_id = _session_id
  ),
  agg AS (
    SELECT l.tab,
      COALESCE((SELECT SUM(quantity * product_price) FROM public.table_session_items
        WHERE session_id = _session_id AND COALESCE(NULLIF(tab_label,''),'Geral') = l.tab), 0) AS subtotal,
      COALESCE((SELECT SUM(amount) FROM public.table_session_payments
        WHERE session_id = _session_id AND COALESCE(NULLIF(tab_label,''),'Geral') = l.tab), 0) AS paid,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',product_name,'qty',quantity,'price',product_price,'notes',notes))
        FROM public.table_session_items WHERE session_id = _session_id AND COALESCE(NULLIF(tab_label,''),'Geral') = l.tab), '[]'::jsonb) AS items
    FROM labels l
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tab', tab, 'subtotal', subtotal, 'paid', paid, 'balance', subtotal - paid, 'items', items
  ) ORDER BY tab), '[]'::jsonb) INTO v_result FROM agg;
  RETURN v_result;
END; $$;

-- RPC: comissões por garçom no período
CREATE OR REPLACE FUNCTION public.get_waiter_commissions(_tenant_id UUID, _from TIMESTAMPTZ, _to TIMESTAMPTZ)
RETURNS TABLE(waiter_id UUID, waiter_name TEXT, commission_percent NUMERIC, orders_count INT, revenue NUMERIC, commission_amount NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.name, w.commission_percent,
    COUNT(o.id)::int AS orders_count,
    COALESCE(SUM(o.total),0) AS revenue,
    ROUND(COALESCE(SUM(o.total),0) * w.commission_percent / 100, 2) AS commission_amount
  FROM public.waiters w
  LEFT JOIN public.table_sessions ts ON ts.assigned_waiter_id = w.id
    AND ts.tenant_id = _tenant_id AND ts.paid_at >= _from AND ts.paid_at <= _to
  LEFT JOIN public.orders o ON o.table_session_id = ts.id AND o.status = 'delivered'
  WHERE w.tenant_id = _tenant_id
  GROUP BY w.id, w.name, w.commission_percent
  ORDER BY revenue DESC;
$$;

-- RPC: Curva ABC de produtos
CREATE OR REPLACE FUNCTION public.get_abc_curve(_tenant_id UUID, _from TIMESTAMPTZ, _to TIMESTAMPTZ)
RETURNS TABLE(product_name TEXT, qty NUMERIC, revenue NUMERIC, cumulative_pct NUMERIC, abc_class TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(oi.quantity * oi.product_price),0) INTO v_total
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
    WHERE o.tenant_id = _tenant_id AND o.status = 'delivered' AND o.created_at >= _from AND o.created_at <= _to;
  IF v_total = 0 THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT oi.product_name AS pname,
      SUM(oi.quantity)::numeric AS q,
      SUM(oi.quantity * oi.product_price)::numeric AS rev
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
    WHERE o.tenant_id = _tenant_id AND o.status = 'delivered'
      AND o.created_at >= _from AND o.created_at <= _to
    GROUP BY oi.product_name
  ),
  ranked AS (
    SELECT pname, q, rev,
      SUM(rev) OVER (ORDER BY rev DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / v_total * 100 AS cum
    FROM base
  )
  SELECT pname, q, rev, ROUND(cum,2),
    CASE WHEN cum <= 80 THEN 'A' WHEN cum <= 95 THEN 'B' ELSE 'C' END
  FROM ranked ORDER BY rev DESC;
END; $$;
