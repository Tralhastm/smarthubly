
CREATE OR REPLACE FUNCTION public.get_stuck_orders(_tenant_id UUID)
RETURNS TABLE(id UUID, status TEXT, customer_name TEXT, table_label TEXT, total NUMERIC, created_at TIMESTAMPTZ, minutes_stuck NUMERIC, severity TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.status, o.customer_name, o.table_label, o.total, o.created_at,
    ROUND(EXTRACT(EPOCH FROM (now() - o.updated_at))/60, 1) AS minutes_stuck,
    CASE
      WHEN o.status = 'preparing' AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 30 THEN 'critico'
      WHEN o.status = 'preparing' AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 15 THEN 'alerta'
      WHEN o.status IN ('ready','ready-for-pickup') AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 20 THEN 'critico'
      WHEN o.status IN ('ready','ready-for-pickup') AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 10 THEN 'alerta'
      WHEN o.status = 'out-for-delivery' AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 90 THEN 'critico'
      WHEN o.status = 'out-for-delivery' AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 60 THEN 'alerta'
      ELSE 'ok'
    END AS severity
  FROM public.orders o
  WHERE o.tenant_id = _tenant_id
    AND o.status IN ('preparing','ready','ready-for-pickup','out-for-delivery')
    AND (
      (o.status = 'preparing' AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 15) OR
      (o.status IN ('ready','ready-for-pickup') AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 10) OR
      (o.status = 'out-for-delivery' AND EXTRACT(EPOCH FROM (now() - o.updated_at))/60 > 60)
    )
  ORDER BY minutes_stuck DESC;
$$;
