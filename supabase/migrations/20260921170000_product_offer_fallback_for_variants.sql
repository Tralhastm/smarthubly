-- Permite que uma lista sem cores ainda participe da escolha de fornecedor
-- para produtos que possuem variações. Ofertas específicas por cor continuam
-- tendo prioridade; o preço do produto é apenas fallback.
CREATE OR REPLACE FUNCTION public.rebuild_supplier_catalog_state(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pv_count integer := 0;
  p_count integer := 0;
BEGIN
  WITH current_snap AS (
    SELECT DISTINCT ON (supplier_id)
      supplier_id,
      id,
      archive_id
    FROM public.supplier_catalog_snapshots
    WHERE tenant_id = _tenant_id
      AND status = 'completed'
    ORDER BY supplier_id, completed_at DESC NULLS LAST, created_at DESC
  ),
  explicit_offer AS (
    SELECT
      o.product_variant_id,
      o.supplier_id,
      o.unit_cost,
      0 AS fallback_priority
    FROM public.supplier_variant_offers o
    JOIN current_snap cs
      ON cs.supplier_id = o.supplier_id
     AND cs.id = o.snapshot_id
    WHERE o.tenant_id = _tenant_id
      AND o.available = true
      AND o.product_variant_id IS NOT NULL
  ),
  product_fallback AS (
    SELECT
      pv.id AS product_variant_id,
      spp.supplier_id,
      spp.unit_price AS unit_cost,
      1 AS fallback_priority
    FROM public.product_variants pv
    JOIN public.products p
      ON p.id = pv.product_id
     AND p.tenant_id = _tenant_id
    JOIN public.supplier_product_prices spp
      ON spp.available = true
     AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
    JOIN current_snap cs
      ON cs.supplier_id = spp.supplier_id
     AND cs.archive_id = spp.source_archive_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM explicit_offer eo
      WHERE eo.product_variant_id = pv.id
        AND eo.supplier_id = spp.supplier_id
    )
  ),
  candidate AS (
    SELECT * FROM explicit_offer
    UNION ALL
    SELECT * FROM product_fallback
  ),
  winner AS (
    SELECT DISTINCT ON (product_variant_id)
      product_variant_id,
      supplier_id,
      unit_cost
    FROM candidate
    ORDER BY product_variant_id, unit_cost ASC, fallback_priority ASC,
      md5(supplier_id || ':' || product_variant_id)
  ),
  target AS (
    SELECT pv.id, w.supplier_id, w.unit_cost
    FROM public.product_variants pv
    LEFT JOIN winner w ON w.product_variant_id = pv.id
    WHERE pv.tenant_id = _tenant_id
  )
  UPDATE public.product_variants pv
  SET supplier_id = t.supplier_id,
      cost_price = CASE WHEN t.supplier_id IS NULL THEN pv.cost_price ELSE t.unit_cost END,
      price_source = CASE WHEN t.supplier_id IS NULL THEN pv.price_source ELSE 'supplier_offer' END,
      in_stock = CASE WHEN t.supplier_id IS NULL THEN false ELSE true END,
      updated_at = now()
  FROM target t
  WHERE pv.id = t.id;
  GET DIAGNOSTICS pv_count = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL,
      in_stock = EXISTS (
        SELECT 1
        FROM public.product_variants pv
        WHERE pv.product_id = p.id
          AND pv.in_stock = 'true'
      ),
      updated_at = now()
  WHERE p.tenant_id = _tenant_id
    AND EXISTS (
      SELECT 1
      FROM public.product_variants pv
      WHERE pv.product_id = p.id
    );

  WITH current_snap AS (
    SELECT DISTINCT ON (supplier_id)
      supplier_id,
      archive_id
    FROM public.supplier_catalog_snapshots
    WHERE tenant_id = _tenant_id
      AND status = 'completed'
    ORDER BY supplier_id, completed_at DESC NULLS LAST, created_at DESC
  ),
  winner AS (
    SELECT DISTINCT ON (p.id)
      p.id AS product_id,
      spp.supplier_id,
      spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp
      ON spp.available = true
     AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
    JOIN current_snap cs
      ON cs.supplier_id = spp.supplier_id
     AND cs.archive_id = spp.source_archive_id
    WHERE p.tenant_id = _tenant_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_variants pv
        WHERE pv.product_id = p.id
      )
    ORDER BY p.id, spp.unit_price ASC,
      md5(spp.supplier_id || ':' || p.id)
  )
  UPDATE public.products p
  SET supplier_id = w.supplier_id,
      original_price = w.unit_price,
      in_stock = true,
      updated_at = now()
  FROM winner w
  WHERE p.id = w.product_id;
  GET DIAGNOSTICS p_count = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL,
      original_price = NULL,
      in_stock = false,
      updated_at = now()
  WHERE p.tenant_id = _tenant_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      WHERE pv.product_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_product_prices spp
      JOIN public.supplier_catalog_snapshots cs
        ON cs.supplier_id = spp.supplier_id
       AND cs.id = spp.snapshot_id
       AND cs.status = 'completed'
      WHERE spp.available = true
        AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
    );

  RETURN jsonb_build_object('products', p_count, 'variants', pv_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_supplier_catalog_state(text) TO service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM public.suppliers LOOP
    PERFORM public.rebuild_supplier_catalog_state(t);
  END LOOP;
END;
$$;
