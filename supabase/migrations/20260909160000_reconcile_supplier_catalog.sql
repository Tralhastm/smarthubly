-- Recalcula o fornecedor vencedor e a disponibilidade da vitrine depois de cada lista.
-- A regra é aplicada por produto/variação, evitando associação majoritária fixa.

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
  SELECT tenant_id INTO v_tenant_id
  FROM public.suppliers
  WHERE id = p_supplier_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'supplier_not_found';
  END IF;

  -- Cada variação escolhe o menor custo disponível. Empates são resolvidos
  -- aleatoriamente, como solicitado, sem favorecer fornecedor fixo.
  WITH winner AS (
    SELECT DISTINCT ON (svo.product_variant_id)
      svo.product_variant_id,
      svo.supplier_id,
      svo.unit_cost
    FROM public.supplier_variant_offers svo
    WHERE svo.tenant_id = v_tenant_id
      AND svo.available = true
      AND svo.product_variant_id IS NOT NULL
    ORDER BY svo.product_variant_id, svo.unit_cost ASC, random()
  )
  UPDATE public.product_variants pv
  SET supplier_id = w.supplier_id,
      cost_price = w.unit_cost,
      price_source = CASE WHEN w.supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
      in_stock = CASE
        WHEN w.supplier_id IS NULL THEN 'false'
        WHEN pv.allow_loss THEN 'true'
        ELSE (
          COALESCE(p.price + COALESCE(pv.price_delta, 0), p.price, 0)
          - (COALESCE(p.price + COALESCE(pv.price_delta, 0), p.price, 0) * 0.046)
          - 20 - 10 - w.unit_cost
        ) >= 0
      END,
      needs_price_review = CASE
        WHEN w.supplier_id IS NULL THEN true
        ELSE false
      END,
      updated_at = now()
  FROM public.products p
  LEFT JOIN winner w ON w.product_variant_id = pv.id
  WHERE pv.product_id = p.id
    AND pv.tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_variants = ROW_COUNT;

  -- Produtos com variações são controlados por variação; não recebem um
  -- fornecedor "majoritário" no produto pai.
  UPDATE public.products p
  SET supplier_id = NULL,
      in_stock = EXISTS (
        SELECT 1 FROM public.product_variants pv
        WHERE pv.product_id = p.id AND pv.in_stock = 'true'
      ),
      updated_at = now()
  WHERE p.tenant_id = v_tenant_id
    AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id);

  -- Produtos sem variação escolhem a menor oferta disponível entre os dois
  -- fornecedores. Sem oferta ou com prejuízo, ficam esgotados na vitrine.
  WITH winner AS (
    SELECT DISTINCT ON (p.id)
      p.id AS product_id,
      spp.supplier_id,
      spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp
      ON spp.available = true
     AND lower(trim(spp.product_name)) = lower(trim(p.name))
    JOIN public.suppliers s ON s.id = spp.supplier_id AND s.tenant_id = p.tenant_id
    WHERE p.tenant_id = v_tenant_id
      AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
    ORDER BY p.id, spp.unit_price ASC, random()
  )
  UPDATE public.products p
  SET supplier_id = w.supplier_id,
      original_price = w.unit_price,
      in_stock = CASE
        WHEN w.supplier_id IS NULL THEN false
        WHEN p.allow_loss THEN true
        ELSE (
          COALESCE(p.price, 0)
          - (COALESCE(p.price, 0) * 0.046)
          - 20 - 10 - w.unit_price
        ) >= 0
      END,
      updated_at = now()
  FROM winner w
  WHERE p.id = w.product_id;
  GET DIAGNOSTICS v_products = ROW_COUNT;

  -- Itens cadastrados na loja mas ausentes de todos os fornecedores ficam
  -- explicitamente esgotados e sem associação.
  UPDATE public.products p
  SET supplier_id = NULL,
      original_price = NULL,
      in_stock = false,
      updated_at = now()
  WHERE p.tenant_id = v_tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_product_prices spp
      JOIN public.suppliers s ON s.id = spp.supplier_id AND s.tenant_id = p.tenant_id
      WHERE spp.available = true
        AND lower(trim(spp.product_name)) = lower(trim(p.name))
    );

  RETURN jsonb_build_object('products', v_products, 'variants', v_variants);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_supplier_catalog(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(TEXT) TO service_role;

-- Garante que o vencedor de uma oferta nunca fique preso a uma associação
-- antiga quando uma oferta for removida ou marcada como indisponível.
CREATE OR REPLACE FUNCTION public.recalculate_variant_supplier_winner(p_variant_id TEXT)
RETURNS VOID AS $$
DECLARE
  winner RECORD;
BEGIN
  SELECT supplier_id, unit_cost INTO winner
  FROM public.supplier_variant_offers
  WHERE product_variant_id = p_variant_id AND available = true
  ORDER BY unit_cost ASC, random()
  LIMIT 1;

  UPDATE public.product_variants pv
  SET supplier_id = winner.supplier_id,
      cost_price = winner.unit_cost,
      price_source = CASE WHEN winner.supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
      in_stock = CASE WHEN winner.supplier_id IS NULL THEN 'false' ELSE pv.in_stock END,
      updated_at = now()
  WHERE pv.id = p_variant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
