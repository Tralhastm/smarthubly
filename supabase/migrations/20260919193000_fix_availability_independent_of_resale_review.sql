-- Disponibilidade depende exclusivamente de oferta presente no snapshot vigente.
-- needs_price_review controla apenas o preço de revenda manual e nunca o estoque.
CREATE OR REPLACE FUNCTION public.rebuild_supplier_catalog_state(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products integer := 0;
  v_variants integer := 0;
BEGIN
  WITH current_snap AS (
    SELECT DISTINCT ON (supplier_id) supplier_id, id
    FROM public.supplier_catalog_snapshots
    WHERE tenant_id = _tenant_id AND status = 'completed'
    ORDER BY supplier_id, completed_at DESC NULLS LAST, created_at DESC
  ), winner AS (
    SELECT DISTINCT ON (o.product_variant_id)
      o.product_variant_id, o.supplier_id, o.unit_cost
    FROM public.supplier_variant_offers o
    JOIN current_snap cs ON cs.supplier_id = o.supplier_id AND cs.id = o.snapshot_id
    WHERE o.tenant_id = _tenant_id
      AND o.available = true
      AND o.product_variant_id IS NOT NULL
    ORDER BY o.product_variant_id, o.unit_cost ASC,
      md5(o.supplier_id || ':' || o.product_variant_id)
  ), target AS (
    SELECT pv.id, w.supplier_id, w.unit_cost
    FROM public.product_variants pv
    LEFT JOIN winner w ON w.product_variant_id = pv.id
    WHERE pv.tenant_id = _tenant_id
  )
  UPDATE public.product_variants pv
  SET supplier_id = t.supplier_id,
      cost_price = CASE
        WHEN t.supplier_id IS NULL THEN pv.cost_price
        ELSE t.unit_cost
      END,
      price_source = CASE
        WHEN t.supplier_id IS NULL THEN pv.price_source
        ELSE 'supplier_offer'
      END,
      -- A oferta presente torna a variação disponível mesmo com revenda pendente.
      in_stock = (t.supplier_id IS NOT NULL)::text,
      updated_at = now()
  FROM target t
  WHERE pv.id = t.id;
  GET DIAGNOSTICS v_variants = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL,
      in_stock = EXISTS (
        SELECT 1
        FROM public.product_variants pv
        WHERE pv.product_id = p.id AND pv.in_stock::text = 'true'
      ),
      updated_at = now()
  WHERE p.tenant_id = _tenant_id
    AND EXISTS (
      SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id
    );

  WITH current_snap AS (
    SELECT DISTINCT ON (supplier_id) supplier_id, id
    FROM public.supplier_catalog_snapshots
    WHERE tenant_id = _tenant_id AND status = 'completed'
    ORDER BY supplier_id, completed_at DESC NULLS LAST, created_at DESC
  ), winner AS (
    SELECT DISTINCT ON (p.id)
      p.id AS product_id, spp.supplier_id, spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp
      ON spp.available = true
      AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
    JOIN current_snap cs
      ON cs.supplier_id = spp.supplier_id AND cs.id = spp.snapshot_id
    WHERE p.tenant_id = _tenant_id
      AND NOT EXISTS (
        SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id
      )
    ORDER BY p.id, spp.unit_price ASC, md5(spp.supplier_id || ':' || p.id)
  )
  UPDATE public.products p
  SET supplier_id = w.supplier_id,
      original_price = w.unit_price,
      in_stock = true,
      updated_at = now()
  FROM winner w
  WHERE p.id = w.product_id;
  GET DIAGNOSTICS v_products = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL,
      original_price = NULL,
      in_stock = false,
      updated_at = now()
  WHERE p.tenant_id = _tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id
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

  RETURN jsonb_build_object('products', v_products, 'variants', v_variants);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_supplier_catalog_state(text) TO service_role;

DO $$
DECLARE v_tenant text;
BEGIN
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM public.suppliers LOOP
    PERFORM public.rebuild_supplier_catalog_state(v_tenant);
  END LOOP;
END;
$$;
