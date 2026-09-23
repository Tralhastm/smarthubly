-- Variantes podem estar marcadas em estoque e ter custo confirmado na tabela
-- de variantes, enquanto a oferta específica ainda não foi materializada em
-- supplier_variant_offers. Nessa situação, usa-se somente a oferta do produto
-- cujo custo coincide com o custo da variante; nunca se escolhe um fornecedor
-- de custo diferente ou uma oferta genérica sem confirmação.
DO $$
DECLARE
  ddl text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO ddl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'place_order'
    AND pg_get_function_identity_arguments(p.oid) = '_order jsonb, _items jsonb';

  IF ddl IS NULL THEN
    RAISE EXCEPTION 'place_order não encontrado';
  END IF;

  ddl := replace(
    ddl,
    'IF v_supplier_id IS NULL THEN RAISE EXCEPTION ''fornecedor_sem_estoque_atual: % / %'', v_product_name, v_variant_name; END IF;',
    $replacement$IF v_supplier_id IS NULL AND v_variant_name <> '' THEN
      SELECT spp.supplier_id::text, spp.unit_price
        INTO v_supplier_id, v_supplier_cost
      FROM public.supplier_product_prices spp
      JOIN public.supplier_catalog_snapshots cs
        ON cs.supplier_id = spp.supplier_id
       AND cs.archive_id = spp.source_archive_id
       AND cs.status = 'completed'
      JOIN public.product_variants pv
        ON pv.product_id = (
          SELECT p2.id
          FROM public.products p2
          WHERE p2.tenant_id = (_order->>'tenant_id')
            AND public.catalog_product_match_key(p2.name) = public.catalog_product_match_key(checkout_fn.v_product_name)
          LIMIT 1
        )
       AND lower(trim(pv.name)) = lower(checkout_fn.v_variant_name)
       AND lower(pv.in_stock) = 'true'
      WHERE spp.available = true
        AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(checkout_fn.v_product_name)
        AND pv.cost_price IS NOT NULL
        AND abs(spp.unit_price - pv.cost_price) < 0.01
      ORDER BY spp.unit_price, md5(spp.supplier_id::text || ':' || checkout_fn.v_product_name)
      LIMIT 1;
    END IF;
    IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'fornecedor_sem_estoque_atual: % / %', v_product_name, v_variant_name; END IF;$replacement$
  );

  EXECUTE ddl;
END $$;

NOTIFY pgrst, 'reload schema';
