-- Hard guard de escrita: disponibilidade de dropshipping só pode ser verdadeira
-- quando existe uma oferta vigente em uma lista temporária ainda válida.

CREATE OR REPLACE FUNCTION public.enforce_supplier_inventory_truth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid_offer BOOLEAN := false;
  v_has_variants BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    -- Bloqueio manual é sempre soberano.
    IF COALESCE(NEW.manual_blocked, false) THEN
      NEW.in_stock := false;
      RETURN NEW;
    END IF;

    IF COALESCE(NEW.in_stock, false) = false THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.product_variants pv WHERE pv.product_id = NEW.id
    ) INTO v_has_variants;

    IF v_has_variants THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.product_variants pv
        JOIN public.supplier_variant_offers svo
          ON svo.product_variant_id = pv.id
         AND svo.tenant_id = NEW.tenant_id
         AND svo.available = true
        JOIN public.supplier_catalog_archives a
          ON a.id = svo.source_archive_id
         AND a.expires_at > now()
        WHERE pv.product_id = NEW.id
      ) INTO v_valid_offer;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.supplier_product_prices spp
        JOIN public.suppliers s
          ON s.id = spp.supplier_id
         AND s.tenant_id = NEW.tenant_id
        JOIN public.supplier_catalog_archives a
          ON a.id = spp.source_archive_id
         AND a.expires_at > now()
        WHERE spp.available = true
          AND public.catalog_product_match_key(spp.product_name) =
              public.catalog_product_match_key(NEW.name)
      ) INTO v_valid_offer;
    END IF;

    IF NOT v_valid_offer THEN
      NEW.in_stock := false;
    END IF;
    RETURN NEW;
  END IF;

  -- product_variants.in_stock é um campo text legado; a comparação textual
  -- evita que uma edição administrativa bypass o guard por incompatibilidade.
  IF COALESCE(NEW.in_stock::text, 'false') = 'false' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_variant_offers svo
    JOIN public.supplier_catalog_archives a
      ON a.id = svo.source_archive_id
     AND a.expires_at > now()
    WHERE svo.tenant_id = NEW.tenant_id
      AND svo.product_variant_id = NEW.id
      AND svo.available = true
  ) INTO v_valid_offer;

  IF NOT v_valid_offer THEN
    NEW.in_stock := 'false';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_supplier_inventory_write_guard ON public.products;
CREATE TRIGGER products_supplier_inventory_write_guard
BEFORE INSERT OR UPDATE OF in_stock, manual_blocked, name, tenant_id
ON public.products
FOR EACH ROW EXECUTE FUNCTION public.enforce_supplier_inventory_truth();

DROP TRIGGER IF EXISTS product_variants_supplier_inventory_write_guard ON public.product_variants;
CREATE TRIGGER product_variants_supplier_inventory_write_guard
BEFORE INSERT OR UPDATE OF in_stock, tenant_id, product_id
ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.enforce_supplier_inventory_truth();

-- Corrigir imediatamente qualquer registro atualmente incoerente.
UPDATE public.product_variants pv
SET in_stock = 'false', updated_at = now()
WHERE pv.in_stock::text = 'true'
  AND NOT EXISTS (
    SELECT 1
    FROM public.supplier_variant_offers svo
    JOIN public.supplier_catalog_archives a
      ON a.id = svo.source_archive_id
     AND a.expires_at > now()
    WHERE svo.tenant_id = pv.tenant_id
      AND svo.product_variant_id = pv.id
      AND svo.available = true
  );

UPDATE public.products p
SET in_stock = false, updated_at = now()
WHERE p.in_stock = true
  AND (
    COALESCE(p.manual_blocked, false)
    OR (
      EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_variants pv
        JOIN public.supplier_variant_offers svo
          ON svo.product_variant_id = pv.id
         AND svo.tenant_id = p.tenant_id
         AND svo.available = true
        JOIN public.supplier_catalog_archives a
          ON a.id = svo.source_archive_id
         AND a.expires_at > now()
        WHERE pv.product_id = p.id
      )
    )
    OR (
      NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.supplier_product_prices spp
        JOIN public.suppliers s
          ON s.id = spp.supplier_id
         AND s.tenant_id = p.tenant_id
        JOIN public.supplier_catalog_archives a
          ON a.id = spp.source_archive_id
         AND a.expires_at > now()
        WHERE spp.available = true
          AND public.catalog_product_match_key(spp.product_name) =
              public.catalog_product_match_key(p.name)
      )
    )
  );
