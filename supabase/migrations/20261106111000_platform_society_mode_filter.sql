-- O consolidado societário considera somente lojas marcadas no cadastro como Sociedade.
-- Consolidado societário do Super Admin.
-- Reusa a mesma apuração oficial da aba Sociedade para cada loja,
-- preservando custos, gastos nomeados e percentuais configurados.
CREATE OR REPLACE FUNCTION public.get_platform_partnership_profit_report(
  _period_start DATE,
  _period_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_totals JSONB;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin'::platform_role) THEN
    RAISE EXCEPTION 'only_super_admin_can_view_platform_society';
  END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_start > _period_end THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  WITH eligible AS (
    SELECT t.id, t.name, t.slug
    FROM public.tenants t
    WHERE t.society_billing_enabled = TRUE
      AND (EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.tenant_id = t.id
        AND o.status = 'delivered'
        AND lower(COALESCE(o.payment_method, '')) <> 'fiado'
        AND o.created_at >= _period_start::TIMESTAMPTZ
        AND o.created_at < (_period_end + 1)::TIMESTAMPTZ
    )
    OR EXISTS (SELECT 1 FROM public.partnership_split_configs sc WHERE sc.tenant_id = t.id)
    OR EXISTS (SELECT 1 FROM public.partnership_settlements ps WHERE ps.tenant_id = t.id))
  ), calculated AS (
    SELECT
      e.id AS tenant_id,
      e.name AS tenant_name,
      e.slug AS tenant_slug,
      public.get_partnership_profit_report(e.id, _period_start, _period_end) AS report,
      (
        SELECT ps.status
        FROM public.partnership_settlements ps
        WHERE ps.tenant_id = e.id
          AND ps.period_start = _period_start
          AND ps.period_end = _period_end
        ORDER BY ps.created_at DESC
        LIMIT 1
      ) AS settlement_status
    FROM eligible e
  ), rows_json AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'tenant_id', tenant_id,
        'tenant_name', tenant_name,
        'tenant_slug', tenant_slug,
        'settlement_status', COALESCE(settlement_status, 'open'),
        'sales_total', COALESCE((report->'summary'->>'sales_total')::NUMERIC, 0),
        'product_cost_total', COALESCE((report->'summary'->>'product_cost_total')::NUMERIC, 0),
        'operating_cost_total', COALESCE((report->'summary'->>'operating_cost_total')::NUMERIC, 0),
        'net_profit', COALESCE((report->'summary'->>'net_profit')::NUMERIC, 0),
        'split_allocations', COALESCE(report->'summary'->'split_allocations', '[]'::JSONB)
      ) ORDER BY COALESCE((report->'summary'->>'net_profit')::NUMERIC, 0) DESC, tenant_name
    ) AS value
    FROM calculated
  ), participant_totals AS (
    SELECT
      allocation->>'name' AS name,
      SUM(COALESCE((allocation->>'percent')::NUMERIC, 0)) AS configured_percent_sum,
      SUM(COALESCE((allocation->>'amount')::NUMERIC, 0)) AS amount
    FROM calculated c
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.report->'summary'->'split_allocations', '[]'::JSONB)) allocation
    GROUP BY allocation->>'name'
  ), totals_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', name,
      'amount', ROUND(amount, 2)
    ) ORDER BY amount DESC), '[]'::JSONB) AS value
    FROM participant_totals
  )
  SELECT COALESCE((SELECT value FROM rows_json), '[]'::JSONB),
         COALESCE((SELECT value FROM totals_json), '[]'::JSONB)
    INTO v_rows, v_totals;

  RETURN jsonb_build_object(
    'period_start', _period_start,
    'period_end', _period_end,
    'stores', v_rows,
    'participant_totals', v_totals,
    'store_count', jsonb_array_length(v_rows),
    'net_profit_total', COALESCE((SELECT SUM(COALESCE((item->>'net_profit')::NUMERIC, 0)) FROM jsonb_array_elements(v_rows) item), 0),
    'sales_total', COALESCE((SELECT SUM(COALESCE((item->>'sales_total')::NUMERIC, 0)) FROM jsonb_array_elements(v_rows) item), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_partnership_profit_report(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_partnership_profit_report(DATE, DATE) TO authenticated;
