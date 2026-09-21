-- Mantém as listas dos fornecedores independentes e escolhe o menor custo ativo
-- por variação, com desempate determinístico.
CREATE OR REPLACE FUNCTION public.recalculate_variant_supplier_winner(p_variant_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE winner RECORD;
BEGIN
  SELECT supplier_id, unit_cost INTO winner
  FROM public.supplier_variant_offers
  WHERE product_variant_id = p_variant_id AND available = true
  ORDER BY unit_cost ASC, updated_at DESC, supplier_id ASC
  LIMIT 1;

  UPDATE public.product_variants pv
  SET supplier_id = winner.supplier_id,
      cost_price = winner.unit_cost,
      price_source = CASE WHEN winner.supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
      in_stock = CASE WHEN winner.supplier_id IS NULL THEN 'false' ELSE pv.in_stock END,
      updated_at = now()
  WHERE pv.id = p_variant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.choose_cheapest_supplier(p_tenant_id text, p_product_name text)
RETURNS TABLE(supplier_id text, supplier_name text, unit_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
  SELECT spp.supplier_id, s.name, spp.unit_price
  FROM public.supplier_product_prices spp
  JOIN public.suppliers s ON s.id = spp.supplier_id
  WHERE s.tenant_id = p_tenant_id
    AND s.active = 'true'
    AND spp.available = true
    AND public.normalize_supplier_product_name(spp.product_name) = public.normalize_supplier_product_name(p_product_name)
  ORDER BY spp.unit_price ASC, spp.updated_at DESC NULLS LAST, spp.supplier_id ASC
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.assign_cheapest_supplier_to_order_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  v_tenant_id text;
  v_supplier_id text;
  v_variant_id text;
BEGIN
  SELECT o.tenant_id INTO v_tenant_id
  FROM public.orders o WHERE o.id = NEW.order_id LIMIT 1;

  IF NEW.variant_name IS NOT NULL AND btrim(NEW.variant_name) <> '' THEN
    SELECT pv.id INTO v_variant_id
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE p.tenant_id = v_tenant_id
      AND public.catalog_product_match_key(p.name) = public.catalog_product_match_key(NEW.product_name)
      AND public.normalize_supplier_product_name(pv.name) = public.normalize_supplier_product_name(NEW.variant_name)
    LIMIT 1;

    IF v_variant_id IS NOT NULL THEN
      SELECT svo.supplier_id INTO v_supplier_id
      FROM public.supplier_variant_offers svo
      JOIN public.suppliers s ON s.id = svo.supplier_id
      WHERE svo.tenant_id = v_tenant_id
        AND svo.product_variant_id = v_variant_id
        AND svo.available = true
        AND s.active = 'true'
      ORDER BY svo.unit_cost ASC, svo.updated_at DESC, svo.supplier_id ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_supplier_id IS NULL THEN
    SELECT c.supplier_id INTO v_supplier_id
    FROM public.choose_cheapest_supplier(v_tenant_id, NEW.product_name) c
    LIMIT 1;
  END IF;

  IF v_supplier_id IS NOT NULL THEN NEW.supplier_id := v_supplier_id; END IF;
  RETURN NEW;
END;
$function$;

DO $block$
DECLARE v record;
BEGIN
  FOR v IN SELECT id FROM public.product_variants LOOP
    PERFORM public.recalculate_variant_supplier_winner(v.id);
  END LOOP;
END
$block$;
