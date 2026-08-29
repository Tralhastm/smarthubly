-- =====================================================================
-- 1) CORRIGE get_dre — usa product_name + JOIN com products para CMV
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_dre(_tenant_id uuid, _from timestamp with time zone, _to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue numeric := 0;
  v_cmv numeric := 0;
  v_expenses numeric := 0;
  v_platform_fee numeric := 0;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_revenue
    FROM public.financial_entries
   WHERE tenant_id = _tenant_id AND type = 'income'
     AND date >= _from AND date <= _to;

  -- CMV: liga order_items.product_name → products.name (mesmo tenant)
  SELECT COALESCE(SUM(oi.quantity * public.calc_product_cmv(p.id)), 0) INTO v_cmv
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.products p ON p.name = oi.product_name AND p.tenant_id = o.tenant_id
   WHERE o.tenant_id = _tenant_id
     AND o.status = 'delivered'
     AND o.created_at >= _from AND o.created_at <= _to;

  SELECT COALESCE(SUM(amount), 0) INTO v_platform_fee
    FROM public.financial_entries
   WHERE tenant_id = _tenant_id AND type = 'expense' AND category = 'taxa_plataforma'
     AND date >= _from AND date <= _to;

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
    FROM public.financial_entries
   WHERE tenant_id = _tenant_id AND type = 'expense'
     AND COALESCE(category,'') <> 'taxa_plataforma'
     AND date >= _from AND date <= _to;

  RETURN jsonb_build_object(
    'revenue', v_revenue,
    'cmv', v_cmv,
    'platform_fee', v_platform_fee,
    'expenses', v_expenses,
    'gross_profit', v_revenue - v_cmv,
    'gross_margin_pct', CASE WHEN v_revenue > 0 THEN ROUND(((v_revenue - v_cmv) / v_revenue * 100)::numeric, 2) ELSE 0 END,
    'net_profit', v_revenue - v_cmv - v_platform_fee - v_expenses
  );
END;
$function$;

-- =====================================================================
-- 2) CORRIGE get_operational_reports — usa product_name e product_price
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_operational_reports(_tenant_id uuid, _from timestamp with time zone, _to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_by_hour JSONB;
  v_by_dow JSONB;
  v_product_mix JSONB;
  v_waiter_perf JSONB;
  v_avg_ticket NUMERIC;
  v_total_orders INTEGER;
  v_total_revenue NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(total),0), COALESCE(AVG(total),0)
    INTO v_total_orders, v_total_revenue, v_avg_ticket
    FROM public.orders
   WHERE tenant_id = _tenant_id AND status = 'delivered'
     AND created_at >= _from AND created_at <= _to;

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

  -- Mix de produtos (top 20) — usa colunas reais: product_name e product_price
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_name', name, 'qty', qty, 'revenue', rev
  ) ORDER BY qty DESC), '[]'::jsonb) INTO v_product_mix
  FROM (
    SELECT COALESCE(oi.product_name, 'Item') AS name,
           SUM(oi.quantity)::numeric AS qty,
           SUM(oi.quantity * oi.product_price)::numeric AS rev
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.tenant_id = _tenant_id AND o.status = 'delivered'
       AND o.created_at >= _from AND o.created_at <= _to
     GROUP BY oi.product_name
     ORDER BY qty DESC
     LIMIT 20
  ) p;

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
$function$;

-- =====================================================================
-- 3) ÍNDICES — drop duplicado + cria compostos críticos
-- =====================================================================
DROP INDEX IF EXISTS public.idx_orders_tenant; -- duplicado de idx_orders_tenant_id

CREATE INDEX IF NOT EXISTS idx_orders_tenant_created
  ON public.orders (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status_created
  ON public.orders (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_entries_tenant_date
  ON public.financial_entries (tenant_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_financial_entries_tenant_type_date
  ON public.financial_entries (tenant_id, type, date DESC);