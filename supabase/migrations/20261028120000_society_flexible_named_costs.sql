-- Sociedade: permite múltiplos gastos nomeados e preserva a especificidade por nome.
-- Migration aditiva: não altera nem remove regras ou fechamentos existentes.

CREATE OR REPLACE FUNCTION public.get_partnership_profit_report(
  _tenant_id TEXT,
  _period_start DATE,
  _period_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role, _tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)) THEN
    RAISE EXCEPTION 'society_access_denied';
  END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_start > _period_end THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  RETURN (
    WITH sold_items AS (
      SELECT
        oi.id AS item_id,
        oi.order_id,
        oi.product_name,
        NULLIF(trim(COALESCE(oi.variant_name, '')), '') AS sold_variant_name,
        GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.cancelled_qty, 0), 0)::NUMERIC AS units,
        COALESCE(oi.product_price, 0)::NUMERIC AS sale_unit_price,
        SUM(
          GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.cancelled_qty, 0), 0)::NUMERIC
          * COALESCE(oi.product_price, 0)::NUMERIC
        ) OVER (PARTITION BY oi.order_id) AS order_sales_total
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.tenant_id = _tenant_id
        AND o.status = 'delivered'
        AND lower(COALESCE(o.payment_method, '')) <> 'fiado'
        AND o.created_at >= _period_start::TIMESTAMPTZ
        AND o.created_at < (_period_end + 1)::TIMESTAMPTZ
    ),
    matched AS (
      SELECT
        si.*,
        p.id AS product_id,
        COALESCE(p.name, si.product_name) AS catalog_product_name,
        COALESCE(p.original_price, 0)::NUMERIC AS product_default_cost,
        pv.id AS variant_id,
        COALESCE(pv.name, si.sold_variant_name) AS catalog_variant_name,
        COALESCE(pv.cost_price, p.original_price, 0)::NUMERIC AS product_cost_per_unit
      FROM sold_items si
      LEFT JOIN LATERAL (
        SELECT p0.id, p0.name, p0.original_price
        FROM public.products p0
        WHERE p0.tenant_id = _tenant_id
          AND lower(trim(p0.name)) = lower(trim(si.product_name))
        ORDER BY p0.updated_at DESC
        LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT pv0.id, pv0.name, pv0.cost_price
        FROM public.product_variants pv0
        WHERE pv0.tenant_id = _tenant_id
          AND pv0.product_id = p.id
          AND si.sold_variant_name IS NOT NULL
          AND lower(trim(pv0.name)) = lower(trim(si.sold_variant_name))
        ORDER BY pv0.updated_at DESC
        LIMIT 1
      ) pv ON true
    ),
    rule_candidates AS (
      SELECT
        m.item_id,
        r.id,
        r.category,
        r.label,
        r.amount_type,
        r.amount,
        r.created_at,
        CASE
          WHEN r.scope = 'variant' THEN 3
          WHEN r.scope = 'product' THEN 2
          ELSE 1
        END AS specificity
      FROM matched m
      JOIN public.partnership_cost_rules r
        ON r.tenant_id = _tenant_id
       AND (
         r.scope = 'general'
         OR (r.scope = 'product' AND r.product_id = m.product_id)
         OR (r.scope = 'variant' AND r.variant_id = m.variant_id)
       )
    ),
    ranked_rules AS (
      SELECT rc.*,
        row_number() OVER (
          PARTITION BY rc.item_id, lower(trim(rc.label))
          ORDER BY rc.specificity DESC, rc.created_at DESC, rc.id DESC
        ) AS rn
      FROM rule_candidates rc
    ),
    item_costs AS (
      SELECT
        m.item_id,
        m.product_id,
        m.catalog_product_name,
        m.variant_id,
        m.catalog_variant_name,
        m.units,
        m.sale_unit_price,
        (m.units * m.sale_unit_price)::NUMERIC AS line_sales,
        (m.units * m.product_cost_per_unit)::NUMERIC AS product_cost_total,
        COALESCE(SUM(
          CASE
            WHEN rr.amount_type = 'percentage_sale'
              THEN (m.units * m.sale_unit_price) * rr.amount / 100
            WHEN rr.amount_type = 'fixed_per_unit'
              THEN m.units * rr.amount
            WHEN rr.amount_type = 'fixed_per_order'
              THEN rr.amount * ((m.units * m.sale_unit_price) / NULLIF(m.order_sales_total, 0))
            ELSE 0
          END
        ), 0)::NUMERIC AS operating_cost_total
      FROM matched m
      LEFT JOIN ranked_rules rr ON rr.item_id = m.item_id AND rr.rn = 1
      GROUP BY
        m.item_id, m.product_id, m.catalog_product_name, m.variant_id,
        m.catalog_variant_name, m.units, m.sale_unit_price, m.order_sales_total,
        m.product_cost_per_unit
    ),
    lines AS (
      SELECT
        COALESCE(product_id::TEXT, 'unmatched') AS product_key,
        product_id,
        catalog_product_name AS product_name,
        variant_id,
        COALESCE(catalog_variant_name, 'Base') AS variant_name,
        SUM(units)::NUMERIC AS units,
        SUM(line_sales)::NUMERIC AS sales_total,
        SUM(product_cost_total)::NUMERIC AS product_cost_total,
        SUM(operating_cost_total)::NUMERIC AS operating_cost_total,
        (SUM(line_sales) - SUM(product_cost_total) - SUM(operating_cost_total))::NUMERIC AS net_profit
      FROM item_costs
      GROUP BY product_id, catalog_product_name, variant_id, COALESCE(catalog_variant_name, 'Base')
    ),
    summary AS (
      SELECT
        COALESCE(SUM(units), 0)::NUMERIC AS units,
        COALESCE(SUM(sales_total), 0)::NUMERIC AS sales_total,
        COALESCE(SUM(product_cost_total), 0)::NUMERIC AS product_cost_total,
        COALESCE(SUM(operating_cost_total), 0)::NUMERIC AS operating_cost_total,
        COALESCE(SUM(net_profit), 0)::NUMERIC AS net_profit
      FROM lines
    )
    SELECT jsonb_build_object(
      'period_start', _period_start,
      'period_end', _period_end,
      'owner_percent', 50,
      'summary', (
        SELECT jsonb_build_object(
          'units', ROUND(s.units, 2),
          'sales_total', ROUND(s.sales_total, 2),
          'product_cost_total', ROUND(s.product_cost_total, 2),
          'operating_cost_total', ROUND(s.operating_cost_total, 2),
          'net_profit', ROUND(s.net_profit, 2),
          'owner_share', ROUND(GREATEST(s.net_profit, 0) * 0.5, 2),
          'operator_share', ROUND(GREATEST(s.net_profit, 0) * 0.5, 2)
        ) FROM summary s
      ),
      'lines', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_id', l.product_id,
            'product_name', l.product_name,
            'variant_id', l.variant_id,
            'variant_name', l.variant_name,
            'units', ROUND(l.units, 2),
            'sale_unit_price', ROUND(l.sales_total / NULLIF(l.units, 0), 2),
            'sales_total', ROUND(l.sales_total, 2),
            'product_cost_total', ROUND(l.product_cost_total, 2),
            'operating_cost_total', ROUND(l.operating_cost_total, 2),
            'net_profit', ROUND(l.net_profit, 2),
            'owner_share', ROUND(GREATEST(l.net_profit, 0) * 0.5, 2),
            'operator_share', ROUND(GREATEST(l.net_profit, 0) * 0.5, 2)
          ) ORDER BY l.sales_total DESC
        ) FROM lines l
      ), '[]'::JSONB)
    )
  );
END;
$$;


REVOKE ALL ON FUNCTION public.get_partnership_profit_report(TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partnership_profit_report(TEXT, DATE, DATE) TO authenticated;
