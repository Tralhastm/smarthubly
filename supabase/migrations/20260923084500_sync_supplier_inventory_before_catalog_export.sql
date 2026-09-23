-- Keep the product variant snapshot aligned with the latest supplier offers
-- immediately before catalog exports and other admin reads.
CREATE OR REPLACE FUNCTION public.sync_supplier_variant_inventory(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available integer := 0;
  v_unavailable integer := 0;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role, _tenant_id)
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
    ORDER BY svo.product_variant_id, svo.unit_cost ASC, svo.updated_at DESC, svo.supplier_id
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
    ORDER BY svo.product_variant_id, svo.unit_cost ASC, svo.updated_at DESC, svo.supplier_id
  )
  UPDATE public.product_variants AS pv
  SET in_stock = false,
      cost_price = NULL,
      supplier_id = NULL,
      updated_at = now()
  WHERE pv.tenant_id = _tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM chosen WHERE chosen.product_variant_id = pv.id
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
      SELECT 1 FROM public.product_variants AS pv WHERE pv.product_id = p.id
    );

  RETURN jsonb_build_object(
    'variants_synced_available', v_available,
    'variants_marked_unavailable', v_unavailable
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_supplier_variant_inventory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_supplier_variant_inventory(uuid) TO authenticated;
