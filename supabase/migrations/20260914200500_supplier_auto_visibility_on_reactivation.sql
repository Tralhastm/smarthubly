-- Quando uma nova lista reativa uma oferta válida, o produto volta à vitrine.
-- Ocultação manual continua disponível no painel; a regra evita que uma
-- indisponibilidade antiga deixe o produto invisível para sempre.
CREATE OR REPLACE FUNCTION public.enforce_supplier_inventory_truth()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_valid_offer BOOLEAN := false;
  v_has_variants BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF COALESCE(NEW.manual_blocked, false) THEN NEW.in_stock := false; RETURN NEW; END IF;
    IF COALESCE(NEW.in_stock, false) = false THEN RETURN NEW; END IF;
    SELECT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = NEW.id) INTO v_has_variants;
    IF v_has_variants THEN
      SELECT EXISTS (
        SELECT 1 FROM public.product_variants pv
        JOIN public.supplier_variant_offers svo ON svo.product_variant_id = pv.id
          AND svo.tenant_id = NEW.tenant_id AND svo.available = true
        WHERE pv.product_id = NEW.id
      ) INTO v_valid_offer;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.supplier_product_prices spp
        JOIN public.suppliers s ON s.id = spp.supplier_id AND s.tenant_id = NEW.tenant_id
        WHERE spp.available = true
          AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(NEW.name)
      ) INTO v_valid_offer;
    END IF;
    IF NOT v_valid_offer THEN NEW.in_stock := false;
    ELSE NEW.store_visible := true;
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.in_stock::text, 'false') = 'false' THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.supplier_variant_offers svo
    WHERE svo.tenant_id = NEW.tenant_id AND svo.product_variant_id = NEW.id AND svo.available = true
  ) INTO v_valid_offer;
  IF NOT v_valid_offer THEN NEW.in_stock := 'false'; END IF;
  RETURN NEW;
END;
$$;
