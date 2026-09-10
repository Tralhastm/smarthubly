CREATE OR REPLACE FUNCTION public.reconcile_supplier_catalog(p_supplier_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id TEXT;
  v_products INTEGER := 0;
  v_variants INTEGER := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.suppliers WHERE id = p_supplier_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'supplier_not_found'; END IF;

  WITH winner AS (
    SELECT DISTINCT ON (svo.product_variant_id)
      svo.product_variant_id, svo.supplier_id, svo.unit_cost
    FROM public.supplier_variant_offers svo
    WHERE svo.tenant_id = v_tenant_id AND svo.available = true AND svo.product_variant_id IS NOT NULL
    ORDER BY svo.product_variant_id, svo.unit_cost ASC, random()
  ), target AS (
    SELECT pv.id, p.price, pv.price_delta, pv.allow_loss,
           w.supplier_id AS winner_supplier_id, w.unit_cost AS winner_cost
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    LEFT JOIN winner w ON w.product_variant_id = pv.id
    WHERE pv.tenant_id = v_tenant_id
  )
  UPDATE public.product_variants pv
  SET supplier_id = t.winner_supplier_id,
      cost_price = t.winner_cost,
      price_source = CASE WHEN t.winner_supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
      in_stock = CASE
        WHEN t.winner_supplier_id IS NULL THEN 'false'
        WHEN t.allow_loss THEN 'true'
        ELSE (COALESCE(t.price + COALESCE(t.price_delta, 0), t.price, 0)
          - (COALESCE(t.price + COALESCE(t.price_delta, 0), t.price, 0) * 0.046)
          - 20 - 10 - t.winner_cost) >= 0
      END,
      needs_price_review = false,
      updated_at = now()
  FROM target t WHERE pv.id = t.id;
  GET DIAGNOSTICS v_variants = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL,
      in_stock = EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.in_stock = 'true'),
      updated_at = now()
  WHERE p.tenant_id = v_tenant_id AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id);

  WITH winner AS (
    SELECT DISTINCT ON (p.id) p.id AS product_id, spp.supplier_id, spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp
      ON spp.available = true
     AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
    JOIN public.suppliers s ON s.id = spp.supplier_id AND s.tenant_id = p.tenant_id
    WHERE p.tenant_id = v_tenant_id AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
    ORDER BY p.id, spp.unit_price ASC, random()
  )
  UPDATE public.products p
  SET supplier_id = w.supplier_id,
      original_price = w.unit_price,
      in_stock = CASE
        WHEN p.allow_loss THEN true
        ELSE (COALESCE(p.price, 0) - (COALESCE(p.price, 0) * 0.046) - 20 - 10 - w.unit_price) >= 0
      END,
      updated_at = now()
  FROM winner w WHERE p.id = w.product_id;
  GET DIAGNOSTICS v_products = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL, original_price = NULL, in_stock = false, updated_at = now()
  WHERE p.tenant_id = v_tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.supplier_product_prices spp
      JOIN public.suppliers s ON s.id = spp.supplier_id AND s.tenant_id = p.tenant_id
      WHERE spp.available = true
        AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
    );

  RETURN jsonb_build_object('products', v_products, 'variants', v_variants);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(TEXT) TO authenticated;
