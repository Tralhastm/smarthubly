-- Limpador automático de resíduos do catálogo.
-- Só corrige estados comprovadamente incoerentes; nunca libera bloqueios manuais
-- nem produtos com conflito ativo.

CREATE OR REPLACE FUNCTION public.clean_supplier_catalog_residuals(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visibility integer := 0;
  v_reasons integer := 0;
  v_variants integer := 0;
BEGIN
  -- Um motivo sem conflito ativo é apenas resíduo histórico e não deve ser exibido.
  UPDATE public.products
  SET catalog_conflict_reason = NULL,
      catalog_conflict_at = NULL,
      updated_at = now()
  WHERE tenant_id = _tenant_id
    AND catalog_conflict IS FALSE
    AND catalog_conflict_reason IS NOT NULL;
  GET DIAGNOSTICS v_reasons = ROW_COUNT;

  -- Um vínculo de fornecedor sem oferta vigente não pode continuar aparecendo
  -- no painel do fornecedor. Não toca em liberações manuais temporárias.
  UPDATE public.product_variants pv
  SET supplier_id = NULL,
      price_source = NULL,
      in_stock = 'false',
      updated_at = now()
  WHERE pv.tenant_id = _tenant_id
    AND pv.manual_supplier_id IS NULL
    AND pv.supplier_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_variant_offers o
      JOIN public.supplier_catalog_snapshots cs
        ON cs.id = o.snapshot_id
       AND cs.status = 'completed'
      WHERE o.tenant_id = _tenant_id
        AND o.product_variant_id = pv.id
        AND o.available IS TRUE
    );
  GET DIAGNOSTICS v_variants = ROW_COUNT;

  -- Produto disponível com oferta/variação vigente não pode ficar oculto por resíduo.
  -- Bloqueios manuais e conflitos ativos ficam intocados.
  UPDATE public.products p
  SET store_visible = true,
      updated_at = now()
  WHERE p.tenant_id = _tenant_id
    AND p.store_visible IS FALSE
    AND p.in_stock IS TRUE
    AND p.manual_blocked IS FALSE
    AND p.catalog_conflict IS FALSE
    AND (
      EXISTS (
        SELECT 1
        FROM public.product_variants pv
        WHERE pv.product_id = p.id
          AND pv.in_stock::text = 'true'
          AND pv.supplier_id IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.supplier_product_prices spp
        JOIN public.supplier_catalog_snapshots cs
          ON cs.supplier_id = spp.supplier_id
         AND cs.id = spp.snapshot_id
         AND cs.status = 'completed'
        WHERE spp.available IS TRUE
          AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(p.name)
      )
    );
  GET DIAGNOSTICS v_visibility = ROW_COUNT;

  RETURN jsonb_build_object(
    'stale_reasons_cleared', v_reasons,
    'stale_variants_cleared', v_variants,
    'hidden_available_products_revealed', v_visibility
  );
END;
$$;

-- Reconciliation remains the source of truth and invokes the cleaner on every import.
CREATE OR REPLACE FUNCTION public.rebuild_supplier_catalog_state(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_products integer := 0;
  v_variants integer := 0;
  v_cleanup jsonb := '{}'::jsonb;
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
    ORDER BY o.product_variant_id, o.unit_cost ASC, md5(o.supplier_id || ':' || o.product_variant_id)
  ), target AS (
    SELECT pv.id, pv.needs_price_review, w.supplier_id, w.unit_cost
    FROM public.product_variants pv
    LEFT JOIN winner w ON w.product_variant_id = pv.id
    WHERE pv.tenant_id = _tenant_id
  )
  UPDATE public.product_variants pv
  SET supplier_id = t.supplier_id,
      cost_price = CASE WHEN t.supplier_id IS NULL THEN pv.cost_price ELSE t.unit_cost END,
      price_source = CASE WHEN t.supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
      in_stock = (t.supplier_id IS NOT NULL AND COALESCE(t.needs_price_review, false) = false)::text,
      updated_at = now()
  FROM target t
  WHERE pv.id = t.id;
  GET DIAGNOSTICS v_variants = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL,
      in_stock = EXISTS (
        SELECT 1 FROM public.product_variants pv
        WHERE pv.product_id = p.id AND pv.in_stock::text = 'true'
      ),
      updated_at = now()
  WHERE p.tenant_id = _tenant_id
    AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id);

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
    JOIN current_snap cs ON cs.supplier_id = spp.supplier_id AND cs.id = spp.snapshot_id
    WHERE p.tenant_id = _tenant_id
      AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
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
    AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
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

  v_cleanup := public.clean_supplier_catalog_residuals(_tenant_id);
  RETURN jsonb_build_object('products', v_products, 'variants', v_variants, 'cleanup', v_cleanup);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clean_supplier_catalog_residuals(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_supplier_catalog_state(text) TO service_role;

-- Corrige resíduos já comprovados sem tocar em conflitos ou bloqueios ativos.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM public.suppliers LOOP
    PERFORM public.clean_supplier_catalog_residuals(t);
  END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION public.clean_supplier_catalog_residuals_after_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.clean_supplier_catalog_residuals(NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clean_supplier_catalog_residuals_after_snapshot ON public.supplier_catalog_snapshots;
CREATE TRIGGER trg_clean_supplier_catalog_residuals_after_snapshot
AFTER UPDATE OF status ON public.supplier_catalog_snapshots
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION public.clean_supplier_catalog_residuals_after_snapshot();

GRANT EXECUTE ON FUNCTION public.clean_supplier_catalog_residuals_after_snapshot() TO service_role;
