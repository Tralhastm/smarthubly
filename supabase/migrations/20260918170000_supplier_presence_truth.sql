-- A presença na lista do fornecedor é a fonte de verdade de disponibilidade.
CREATE OR REPLACE FUNCTION public.reconcile_supplier_catalog(p_supplier_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id TEXT; v_products INTEGER := 0; v_variants INTEGER := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.suppliers WHERE id = p_supplier_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'supplier_not_found'; END IF;

  -- Ofertas atuais tornam a cor disponível mesmo quando o custo ainda é zero.
  WITH winner AS (
    SELECT DISTINCT ON (svo.product_variant_id)
      svo.product_variant_id, svo.supplier_id, svo.unit_cost
    FROM public.supplier_variant_offers svo
    WHERE svo.tenant_id = v_tenant_id AND svo.available = true AND svo.product_variant_id IS NOT NULL
    ORDER BY svo.product_variant_id, svo.unit_cost ASC, svo.updated_at DESC
  )
  UPDATE public.product_variants pv
  SET supplier_id = w.supplier_id,
      cost_price = CASE WHEN w.unit_cost = 0 THEN NULL ELSE w.unit_cost END,
      price_source = 'supplier_offer',
      in_stock = 'true',
      needs_price_review = (w.unit_cost = 0),
      updated_at = now()
  FROM winner w
  WHERE pv.id = w.product_variant_id AND pv.tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_variants = ROW_COUNT;

  -- Qualquer cor não reencontrada na fotografia atual fica esgotada, sem apagar cadastro.
  UPDATE public.product_variants pv
  SET supplier_id = NULL, cost_price = NULL, price_source = NULL,
      in_stock = 'false', needs_price_review = true, updated_at = now()
  WHERE pv.tenant_id = v_tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM public.supplier_variant_offers svo
      WHERE svo.product_variant_id = pv.id AND svo.supplier_id = p_supplier_id AND svo.available = true
    );

  UPDATE public.products p
  SET supplier_id = NULL,
      in_stock = EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.in_stock = 'true'),
      updated_at = now()
  WHERE p.tenant_id = v_tenant_id
    AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id);

  WITH winner AS (
    SELECT DISTINCT ON (p.id) p.id AS product_id, spp.supplier_id, spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp
      ON spp.available = true
     AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
    JOIN public.suppliers s ON s.id = spp.supplier_id AND s.tenant_id = p.tenant_id
    WHERE p.tenant_id = v_tenant_id
      AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
    ORDER BY p.id, spp.unit_price ASC, spp.updated_at DESC
  )
  UPDATE public.products p
  SET supplier_id = w.supplier_id, original_price = w.unit_price, in_stock = true, updated_at = now()
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
END; $$;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(TEXT) TO authenticated;
