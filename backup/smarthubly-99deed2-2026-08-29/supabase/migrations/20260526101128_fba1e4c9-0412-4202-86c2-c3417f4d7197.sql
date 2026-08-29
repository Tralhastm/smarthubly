
-- KPIs executivos
CREATE OR REPLACE FUNCTION public.get_executive_kpis(_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today_rev NUMERIC := 0; v_today_orders INT := 0;
  v_yesterday_rev NUMERIC := 0;
  v_last_week_same_dow_rev NUMERIC := 0;
  v_avg_ticket NUMERIC := 0;
  v_active_orders INT := 0;
  v_cancel_rate NUMERIC := 0;
  v_best_hour INT := NULL;
  v_total_30d INT := 0; v_cancelled_30d INT := 0;
BEGIN
  SELECT COALESCE(SUM(total),0), COUNT(*) INTO v_today_rev, v_today_orders
    FROM public.orders WHERE tenant_id = _tenant_id AND status = 'delivered'
    AND created_at::date = current_date;

  SELECT COALESCE(SUM(total),0) INTO v_yesterday_rev
    FROM public.orders WHERE tenant_id = _tenant_id AND status = 'delivered'
    AND created_at::date = current_date - 1;

  SELECT COALESCE(SUM(total),0) INTO v_last_week_same_dow_rev
    FROM public.orders WHERE tenant_id = _tenant_id AND status = 'delivered'
    AND created_at::date = current_date - 7;

  SELECT COALESCE(AVG(total),0) INTO v_avg_ticket
    FROM public.orders WHERE tenant_id = _tenant_id AND status = 'delivered'
    AND created_at >= current_date - 30;

  SELECT COUNT(*) INTO v_active_orders FROM public.orders
   WHERE tenant_id = _tenant_id
     AND status IN ('received','preparing','ready-for-pickup','out-for-delivery');

  SELECT COUNT(*) INTO v_total_30d FROM public.orders
   WHERE tenant_id = _tenant_id AND created_at >= current_date - 30;
  SELECT COUNT(*) INTO v_cancelled_30d FROM public.orders
   WHERE tenant_id = _tenant_id AND status = 'cancelled' AND created_at >= current_date - 30;
  v_cancel_rate := CASE WHEN v_total_30d > 0 THEN ROUND(v_cancelled_30d::numeric / v_total_30d * 100, 2) ELSE 0 END;

  SELECT EXTRACT(HOUR FROM created_at)::int INTO v_best_hour
    FROM public.orders WHERE tenant_id = _tenant_id AND status = 'delivered'
    AND created_at >= current_date - 30
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY SUM(total) DESC LIMIT 1;

  RETURN jsonb_build_object(
    'today_revenue', v_today_rev,
    'today_orders', v_today_orders,
    'yesterday_revenue', v_yesterday_rev,
    'last_week_revenue', v_last_week_same_dow_rev,
    'avg_ticket_30d', v_avg_ticket,
    'active_orders', v_active_orders,
    'cancel_rate_30d', v_cancel_rate,
    'best_hour', v_best_hour
  );
END; $$;

-- Previsão de demanda (média por DOW últimas 8 semanas)
CREATE OR REPLACE FUNCTION public.get_demand_forecast(_tenant_id UUID)
RETURNS TABLE(forecast_date DATE, dow INT, predicted_orders NUMERIC, predicted_revenue NUMERIC, confidence TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE i INT;
BEGIN
  FOR i IN 0..6 LOOP
    forecast_date := current_date + i;
    dow := EXTRACT(DOW FROM forecast_date)::int;
    SELECT
      COALESCE(ROUND(AVG(daily_orders), 1), 0),
      COALESCE(ROUND(AVG(daily_rev), 2), 0),
      CASE WHEN COUNT(*) >= 4 THEN 'alta' WHEN COUNT(*) >= 2 THEN 'media' ELSE 'baixa' END
    INTO predicted_orders, predicted_revenue, confidence
    FROM (
      SELECT created_at::date AS d, COUNT(*) AS daily_orders, SUM(total) AS daily_rev
        FROM public.orders
       WHERE tenant_id = _tenant_id AND status = 'delivered'
         AND created_at >= current_date - 56
         AND EXTRACT(DOW FROM created_at)::int = dow
       GROUP BY created_at::date
    ) hist;
    RETURN NEXT;
  END LOOP;
END; $$;

-- Heatmap dia × hora
CREATE OR REPLACE FUNCTION public.get_heatmap(_tenant_id UUID, _days INT DEFAULT 30)
RETURNS TABLE(dow INT, hour INT, orders INT, revenue NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXTRACT(DOW FROM created_at)::int,
         EXTRACT(HOUR FROM created_at)::int,
         COUNT(*)::int,
         COALESCE(SUM(total),0)
    FROM public.orders
   WHERE tenant_id = _tenant_id AND status = 'delivered'
     AND created_at >= current_date - _days
   GROUP BY 1, 2;
$$;
