-- Reconciliation and catalog sync functions must preserve a marked demo test
-- variant while demo payments remain enabled. Outside this exact case, behavior
-- remains the same as the current production definitions.

CREATE OR REPLACE FUNCTION public.reconcile_supplier_catalog(p_supplier_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id text;
  v_products integer := 0;
  v_variants integer := 0;
BEGIN
  SELECT tenant_id
  INTO v_tenant_id
  FROM public.suppliers
  WHERE id = p_supplier_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'supplier_not_found';
  END IF;

  WITH candidate AS (
    SELECT
      svo.product_variant_id,
      svo.supplier_id,
      svo.unit_cost
    FROM public.supplier_variant_offers svo
    JOIN public.supplier_catalog_archives a
      ON a.id = svo.source_archive_id
     AND a.expires_at > now()
    JOIN public.suppliers s
      ON s.id = svo.supplier_id
     AND s.tenant_id = v_tenant_id
    WHERE svo.tenant_id = v_tenant_id
      AND svo.available = true
      AND svo.product_variant_id IS NOT NULL
  ), winner AS (
    SELECT DISTINCT ON (product_variant_id)
      product_variant_id,
      supplier_id,
      unit_cost
    FROM candidate
    ORDER BY product_variant_id, unit_cost ASC,
      md5(supplier_id || ':' || product_variant_id)
  ), target AS (
    SELECT
      pv.id,
      p.price,
      pv.price_delta,
      pv.allow_loss,
      pv.suggested_price,
      pv.demo_stock_override,
      COALESCE(t.demo_payment_enabled, false) AS demo_payment_enabled,
      w.supplier_id AS winner_supplier_id,
      w.unit_cost AS winner_cost
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    LEFT JOIN public.tenants t ON t.id = pv.tenant_id
    LEFT JOIN winner w ON w.product_variant_id = pv.id
    WHERE pv.tenant_id = v_tenant_id
  )
  UPDATE public.product_variants pv
  SET supplier_id = target.winner_supplier_id,
      cost_price = target.winner_cost,
      price_source = CASE
        WHEN target.winner_supplier_id IS NULL THEN NULL
        ELSE 'supplier_offer'
      END,
      in_stock = CASE
        WHEN target.demo_stock_override IS TRUE
             AND target.demo_payment_enabled IS TRUE THEN 'true'
        WHEN target.winner_supplier_id IS NULL THEN 'false'
        WHEN target.allow_loss THEN 'true'
        ELSE CASE
          WHEN (
            COALESCE(target.price + COALESCE(target.price_delta, 0), target.price, 0)
            - (COALESCE(target.price + COALESCE(target.price_delta, 0), target.price, 0) * 0.0499)
            - 50 - 10 - target.winner_cost
          ) >= 0 THEN 'true'
          ELSE 'false'
        END
      END,
      needs_price_review = CASE
        WHEN target.winner_supplier_id IS NULL THEN false
        ELSE COALESCE(target.suggested_price, 0) <= 0
      END,
      updated_at = now()
  FROM target
  WHERE pv.id = target.id;

  GET DIAGNOSTICS v_variants = ROW_COUNT;

  UPDATE public.products p
  SET supplier_id = NULL,
      in_stock = EXISTS (
        SELECT 1
        FROM public.product_variants pv
        WHERE pv.product_id = p.id
          AND pv.in_stock::text = 'true'
      ),
      updated_at = now()
  WHERE p.tenant_id = v_tenant_id
    AND EXISTS (
      SELECT 1
      FROM public.product_variants pv
      WHERE pv.product_id = p.id
    );

  WITH winner AS (
    SELECT DISTINCT ON (p.id)
      p.id AS product_id,
      spp.supplier_id,
      spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp
      ON spp.available = true
     AND public.catalog_product_match_key(spp.product_name) =
         public.catalog_product_match_key(p.name)
    JOIN public.supplier_catalog_archives a
      ON a.id = spp.source_archive_id
     AND a.expires_at > now()
    JOIN public.suppliers s
      ON s.id = spp.supplier_id
     AND s.tenant_id = p.tenant_id
    WHERE p.tenant_id = v_tenant_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_variants pv
        WHERE pv.product_id = p.id
      )
    ORDER BY p.id, spp.unit_price ASC,
      md5(spp.supplier_id || ':' || p.id)
  )
  UPDATE public.products p
  SET supplier_id = winner.supplier_id,
      original_price = winner.unit_price,
      in_stock = CASE
        WHEN p.allow_loss THEN true
        ELSE (
          COALESCE(p.price, 0)
          - (COALESCE(p.price, 0) * 0.0499)
          - 50 - 10 - winner.unit_price
        ) >= 0
      END,
      updated_at = now()
  FROM winner
  WHERE p.id = winner.product_id;

  GET DIAGNOSTICS v_products = ROW_COUNT;
  RETURN jsonb_build_object('products', v_products, 'variants', v_variants);
END;
$function$;

-- Alterações em supplier_variant_offers também podem recalcular a variante.
CREATE OR REPLACE FUNCTION public.recalculate_variant_supplier_winner(p_variant_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  winner record;
BEGIN
  SELECT supplier_id, unit_cost
  INTO winner
  FROM public.supplier_variant_offers
  WHERE product_variant_id = p_variant_id
    AND available = true
  ORDER BY unit_cost ASC, updated_at DESC, supplier_id ASC
  LIMIT 1;

  UPDATE public.product_variants pv
  SET supplier_id = winner.supplier_id,
      cost_price = winner.unit_cost,
      price_source = CASE
        WHEN winner.supplier_id IS NULL THEN NULL
        ELSE 'supplier_offer'
      END,
      in_stock = CASE
        WHEN pv.demo_stock_override IS TRUE
             AND EXISTS (
               SELECT 1
               FROM public.tenants t
               WHERE t.id = pv.tenant_id
                 AND t.demo_payment_enabled IS TRUE
             ) THEN 'true'
        WHEN winner.supplier_id IS NULL THEN 'false'
        ELSE pv.in_stock
      END,
      updated_at = now()
  WHERE pv.id = p_variant_id;
END;
$function$;

-- Importação atômica chama rebuild_supplier_catalog_state.
CREATE OR REPLACE FUNCTION public.rebuild_supplier_catalog_state(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  ), explicit_offer AS (
    SELECT
      o.product_variant_id,
      o.supplier_id,
      o.unit_cost
    FROM public.supplier_variant_offers o
    JOIN current_snap cs
      ON cs.supplier_id = o.supplier_id
     AND cs.id = o.snapshot_id
    JOIN public.supplier_catalog_archives a
      ON a.id = o.source_archive_id
     AND a.expires_at > now()
    WHERE o.tenant_id = _tenant_id
      AND o.available = true
      AND o.product_variant_id IS NOT NULL
      AND o.unit_cost IS NOT NULL
  ), winner AS (
    SELECT DISTINCT ON (product_variant_id)
      product_variant_id,
      supplier_id,
      unit_cost
    FROM explicit_offer
    ORDER BY product_variant_id, unit_cost ASC,
      md5(supplier_id || ':' || product_variant_id)
  ), target AS (
    SELECT
      pv.id,
      w.supplier_id,
      w.unit_cost,
      pv.suggested_price,
      pv.demo_stock_override,
      COALESCE(t.demo_payment_enabled, false) AS demo_payment_enabled
    FROM public.product_variants pv
    LEFT JOIN public.tenants t ON t.id = pv.tenant_id
    LEFT JOIN winner w ON w.product_variant_id = pv.id
    WHERE pv.tenant_id = _tenant_id
  )
  UPDATE public.product_variants pv
  SET supplier_id = t.supplier_id,
      cost_price = t.unit_cost,
      price_source = CASE
        WHEN t.supplier_id IS NULL THEN NULL
        ELSE 'supplier_offer'
      END,
      in_stock = CASE
        WHEN t.demo_stock_override IS TRUE
             AND t.demo_payment_enabled IS TRUE THEN 'true'
        WHEN t.supplier_id IS NULL THEN 'false'
        ELSE 'true'
      END,
      needs_price_review = CASE
        WHEN t.supplier_id IS NULL THEN false
        ELSE COALESCE(t.suggested_price, 0) <= 0
      END,
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
          AND pv.in_stock::text = 'true'
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
  ), winner AS (
    SELECT DISTINCT ON (p.id)
      p.id AS product_id,
      spp.supplier_id,
      spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp
      ON spp.available = true
     AND spp.unit_price IS NOT NULL
     AND public.catalog_product_match_key(spp.product_name) =
         public.catalog_product_match_key(p.name)
    JOIN current_snap cs
      ON cs.supplier_id = spp.supplier_id
     AND cs.archive_id = spp.source_archive_id
    JOIN public.supplier_catalog_archives a
      ON a.id = spp.source_archive_id
     AND a.expires_at > now()
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
      JOIN public.supplier_catalog_archives a
        ON a.id = spp.source_archive_id
       AND a.expires_at > now()
      WHERE spp.available = true
        AND public.catalog_product_match_key(spp.product_name) =
            public.catalog_product_match_key(p.name)
    );

  RETURN jsonb_build_object('products', p_count, 'variants', pv_count);
END;
$function$;

-- Sincronização manual: indisponibilidades reais não derrubam a variante demo.
CREATE OR REPLACE FUNCTION public.sync_supplier_variant_inventory(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_available integer := 0;
  v_unavailable integer := 0;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role, _tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::public.platform_role)
  ) THEN
    RAISE EXCEPTION 'not_authorized_for_tenant';
  END IF;

  WITH chosen AS (
    SELECT DISTINCT ON (svo.product_variant_id)
      svo.product_variant_id,
      svo.supplier_id,
      svo.unit_cost
    FROM public.supplier_variant_offers AS svo
    WHERE svo.tenant_id = _tenant_id
      AND svo.available = true
      AND svo.unit_cost IS NOT NULL
    ORDER BY svo.product_variant_id, svo.unit_cost ASC,
      svo.updated_at DESC, svo.supplier_id
  )
  UPDATE public.product_variants AS pv
  SET in_stock = true,
      cost_price = chosen.unit_cost,
      supplier_id = chosen.supplier_id,
      updated_at = now()
  FROM chosen
  WHERE pv.tenant_id = _tenant_id
    AND pv.id = chosen.product_variant_id;
  GET DIAGNOSTICS v_available = ROW_COUNT;

  WITH chosen AS (
    SELECT DISTINCT ON (svo.product_variant_id)
      svo.product_variant_id
    FROM public.supplier_variant_offers AS svo
    WHERE svo.tenant_id = _tenant_id
      AND svo.available = true
      AND svo.unit_cost IS NOT NULL
    ORDER BY svo.product_variant_id, svo.unit_cost ASC,
      svo.updated_at DESC, svo.supplier_id
  )
  UPDATE public.product_variants AS pv
  SET in_stock = CASE
        WHEN pv.demo_stock_override IS TRUE
             AND EXISTS (
               SELECT 1
               FROM public.tenants t
               WHERE t.id = pv.tenant_id
                 AND t.demo_payment_enabled IS TRUE
             ) THEN 'true'
        ELSE 'false'
      END,
      cost_price = NULL,
      supplier_id = NULL,
      updated_at = now()
  WHERE pv.tenant_id = _tenant_id
    AND NOT EXISTS (
      SELECT 1
      FROM chosen
      WHERE chosen.product_variant_id = pv.id
    );
  GET DIAGNOSTICS v_unavailable = ROW_COUNT;

  UPDATE public.products AS p
  SET in_stock = EXISTS (
        SELECT 1
        FROM public.product_variants AS pv
        WHERE pv.product_id = p.id
          AND pv.in_stock::boolean = true
      ),
      updated_at = now()
  WHERE p.tenant_id = _tenant_id
    AND EXISTS (
      SELECT 1
      FROM public.product_variants AS pv
      WHERE pv.product_id = p.id
    );

  RETURN jsonb_build_object(
    'variants_synced_available', v_available,
    'variants_marked_unavailable', v_unavailable
  );
END;
$function$;

-- Evita que a limpeza de resíduos desative uma variante demo válida.
CREATE OR REPLACE FUNCTION public.clean_supplier_catalog_residuals(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_visibility integer := 0;
  v_reasons integer := 0;
  v_variants integer := 0;
BEGIN
  UPDATE public.products
  SET catalog_conflict_reason = NULL,
      catalog_conflict_at = NULL,
      updated_at = now()
  WHERE tenant_id = _tenant_id
    AND catalog_conflict IS FALSE
    AND catalog_conflict_reason IS NOT NULL;
  GET DIAGNOSTICS v_reasons = ROW_COUNT;

  UPDATE public.product_variants pv
  SET supplier_id = NULL,
      price_source = NULL,
      in_stock = 'false',
      updated_at = now()
  WHERE pv.tenant_id = _tenant_id
    AND pv.manual_supplier_id IS NULL
    AND pv.supplier_id IS NOT NULL
    AND COALESCE(pv.demo_stock_override, false) IS FALSE
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
          AND public.catalog_product_match_key(spp.product_name) =
              public.catalog_product_match_key(p.name)
      )
    );
  GET DIAGNOSTICS v_visibility = ROW_COUNT;

  RETURN jsonb_build_object(
    'stale_reasons_cleared', v_reasons,
    'stale_variants_cleared', v_variants,
    'hidden_available_products_revealed', v_visibility
  );
END;
$function$;
