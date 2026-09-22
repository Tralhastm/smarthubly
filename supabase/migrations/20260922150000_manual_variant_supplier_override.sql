-- Override temporário para uma variante liberada manualmente.
-- A importação de qualquer nova lista limpa este campo para a reconciliação automática.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS manual_supplier_id uuid;

COMMENT ON COLUMN public.product_variants.manual_supplier_id IS
  'Fornecedor temporário escolhido manualmente para esta variação; deve ser limpo na próxima importação.';

CREATE INDEX IF NOT EXISTS product_variants_manual_supplier_idx
  ON public.product_variants (manual_supplier_id)
  WHERE manual_supplier_id IS NOT NULL;

-- O RPC de checkout respeita o override manual apenas enquanto ele existir.
CREATE OR REPLACE FUNCTION public.place_order(_order jsonb, _items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_id text;
  payload jsonb;
  cols text;
  it jsonb;
  product_name text;
  variant_name text;
  supplier_id text;
  supplier_cost numeric;
  fragments jsonb := '{}'::jsonb;
  fragment_key text;
  fragment_items jsonb;
  item_with_supplier jsonb;
  has_variants boolean;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    product_name := trim(COALESCE(it->>'product_name', it->'product'->>'name', ''));
    variant_name := trim(COALESCE(it->>'variant_name', it->'variantName', it->>'variant', ''));
    IF product_name = '' THEN RAISE EXCEPTION 'item_produto_obrigatorio'; END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE p.tenant_id = (_order->>'tenant_id')
        AND public.catalog_product_match_key(p.name) = public.catalog_product_match_key(product_name)
    ) INTO has_variants;

    supplier_id := NULL;
    supplier_cost := NULL;

    IF has_variants AND variant_name <> '' THEN
      -- Liberação manual tem precedência e não depende da oferta ainda aparecer
      -- na lista atual. O custo salvo na variante é usado no lote do fornecedor.
      SELECT pv.manual_supplier_id::text, pv.cost_price
        INTO supplier_id, supplier_cost
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      JOIN public.suppliers s ON s.id = pv.manual_supplier_id
      WHERE p.tenant_id = (_order->>'tenant_id')
        AND s.tenant_id = (_order->>'tenant_id')
        AND public.catalog_product_match_key(p.name) = public.catalog_product_match_key(product_name)
        AND lower(trim(pv.name)) = lower(variant_name)
        AND pv.in_stock = true
        AND pv.manual_supplier_id IS NOT NULL
      LIMIT 1;

      IF supplier_id IS NULL THEN
        SELECT o.supplier_id::text, o.unit_cost
          INTO supplier_id, supplier_cost
        FROM public.supplier_variant_offers o
        JOIN public.supplier_catalog_snapshots cs
          ON cs.id = o.snapshot_id AND cs.status = 'completed'
        WHERE o.tenant_id = (_order->>'tenant_id')
          AND o.available = true
          AND o.product_variant_id = (
            SELECT pv.id FROM public.product_variants pv
            JOIN public.products p ON p.id = pv.product_id
            WHERE p.tenant_id = (_order->>'tenant_id')
              AND public.catalog_product_match_key(p.name) = public.catalog_product_match_key(product_name)
              AND lower(trim(pv.name)) = lower(variant_name)
            LIMIT 1
          )
        ORDER BY o.unit_cost, md5(o.supplier_id::text || ':' || o.product_variant_id::text)
        LIMIT 1;
      END IF;
    ELSE
      SELECT spp.supplier_id::text, spp.unit_price
        INTO supplier_id, supplier_cost
      FROM public.supplier_product_prices spp
      JOIN public.supplier_catalog_snapshots cs
        ON cs.supplier_id = spp.supplier_id
       AND cs.archive_id = spp.source_archive_id
       AND cs.status = 'completed'
      WHERE spp.available = true
        AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(product_name)
      ORDER BY spp.unit_price, md5(spp.supplier_id::text || ':' || product_name)
      LIMIT 1;
    END IF;

    IF supplier_id IS NULL THEN RAISE EXCEPTION 'fornecedor_sem_estoque_atual: % / %', product_name, variant_name; END IF;
    item_with_supplier := it || jsonb_build_object('supplier_id', supplier_id, 'supplier_cost', supplier_cost);
    fragment_items := COALESCE(fragments->supplier_id, '[]'::jsonb) || jsonb_build_array(item_with_supplier);
    fragments := jsonb_set(fragments, ARRAY[supplier_id], fragment_items, true);
  END LOOP;

  payload := (_order - 'id' - 'created_at' - 'updated_at') || jsonb_build_object('metadata', COALESCE(_order->'metadata', '{}'::jsonb) || jsonb_build_object('fragmentation_map', fragments));
  SELECT string_agg(format('%I', key), ',') INTO cols
  FROM jsonb_object_keys(payload) AS key
  WHERE EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'orders' AND c.column_name = key);
  EXECUTE format('INSERT INTO public.orders(%s) SELECT %s FROM jsonb_populate_record(null::public.orders, $1) RETURNING id', cols, cols) USING payload INTO order_id;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    payload := (it - 'id' - 'created_at') || jsonb_build_object('order_id', order_id);
    SELECT string_agg(format('%I', key), ',') INTO cols
    FROM jsonb_object_keys(payload) AS key
    WHERE EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'order_items' AND c.column_name = key);
    EXECUTE format('INSERT INTO public.order_items(%s) SELECT %s FROM jsonb_populate_record(null::public.order_items, $1)', cols, cols) USING payload;
  END LOOP;

  FOR fragment_key IN SELECT jsonb_object_keys(fragments) LOOP
    fragment_items := fragments->fragment_key;
    INSERT INTO public.order_fragments(order_id, tenant_id, supplier_id, items, total, status)
    VALUES (order_id, _order->>'tenant_id', fragment_key, fragment_items,
      (SELECT SUM(COALESCE((x->>'supplier_cost')::numeric, 0) * COALESCE((x->>'quantity')::numeric, 0)) FROM jsonb_array_elements(fragment_items) x),
      COALESCE(_order->>'status', 'pending'));
    UPDATE public.order_items oi SET supplier_id = fragment_key
    WHERE oi.order_id = order_id AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(fragment_items) x
      WHERE COALESCE(x->>'product_name', x->'product'->>'name') = oi.product_name
        AND COALESCE(x->>'variant_name', x->>'variantName', x->>'variant', '') = COALESCE(oi.variant_name, '')
    );
  END LOOP;
  RETURN order_id::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
