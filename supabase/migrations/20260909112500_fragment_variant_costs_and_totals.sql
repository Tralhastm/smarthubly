-- Usa o custo da variante/oferta no total operacional do fornecedor.
-- Mantém o preço de venda do pedido separado do custo de compra.
CREATE OR REPLACE FUNCTION public.place_order(_order jsonb, _items jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _payload jsonb;
  _cols text;
  _it jsonb;
  _fragment_pair record;
  _fragment_item jsonb;
  _supplier_id text;
  _fragment_items jsonb;
  _fragment_total numeric;
  _product_name text;
  _variant_name text;
BEGIN
  _payload := (SELECT jsonb_object_agg(k, v)
                 FROM jsonb_each(_order - 'id' - 'created_at' - 'updated_at') AS t(k, v)
                WHERE v <> 'null'::jsonb
                  AND EXISTS (SELECT 1 FROM information_schema.columns c
                               WHERE c.table_schema='public' AND c.table_name='orders' AND c.column_name = k));
  SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;
  EXECUTE format(
    'INSERT INTO public.orders (%s) SELECT %s FROM jsonb_populate_record(null::public.orders, $1) RETURNING id',
    _cols, _cols
  ) USING _payload INTO _id;

  FOR _it IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb))
  LOOP
    _payload := (SELECT jsonb_object_agg(k, v)
                   FROM jsonb_each((_it - 'id' - 'created_at') || jsonb_build_object('order_id', _id)) AS t(k, v)
                  WHERE EXISTS (SELECT 1 FROM information_schema.columns c
                                 WHERE c.table_schema='public' AND c.table_name='order_items' AND c.column_name = k));
    SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;
    EXECUTE format(
      'INSERT INTO public.order_items (%s) SELECT %s FROM jsonb_populate_record(null::public.order_items, $1)',
      _cols, _cols
    ) USING _payload;
  END LOOP;

  FOR _fragment_pair IN
    SELECT key AS supplier_id, value AS items
    FROM jsonb_each(COALESCE(_order->'metadata'->'fragmentation_map', '{}'::jsonb))
  LOOP
    _supplier_id := _fragment_pair.supplier_id;
    _fragment_items := COALESCE(_fragment_pair.items, '[]'::jsonb);

    -- Prioridade: custo da variante do fornecedor; depois custo da variante
    -- vencedora no catálogo; por último preço do item para compatibilidade.
    SELECT COALESCE(SUM(
      COALESCE((item->>'quantity')::numeric, 0) * COALESCE(
        (SELECT svo.unit_cost
           FROM public.supplier_variant_offers svo
          WHERE svo.supplier_id = _supplier_id
            AND svo.available = true
            AND (svo.product_variant_id::text = NULLIF(item->>'variantId', '')
                 OR (svo.product_id = NULLIF(item->'product'->>'id', '')
                     AND svo.variant_key = lower(trim(COALESCE(item->>'variantName', item->>'variant_name', '')))))
          ORDER BY (svo.product_variant_id::text = NULLIF(item->>'variantId', '')) DESC, svo.updated_at DESC
          LIMIT 1),
        (SELECT pv.cost_price FROM public.product_variants pv WHERE pv.id::text = NULLIF(item->>'variantId', '')),
        (item->>'product_price')::numeric,
        0
      )
    ), 0)
      INTO _fragment_total
      FROM jsonb_array_elements(_fragment_items) AS x(item);

    INSERT INTO public.order_fragments(order_id, tenant_id, supplier_id, items, total, status)
    VALUES (_id::text, _order->>'tenant_id', _supplier_id, _fragment_items, _fragment_total, 'received');

    FOR _fragment_item IN SELECT * FROM jsonb_array_elements(_fragment_items)
    LOOP
      _product_name := _fragment_item->'product'->>'name';
      IF _product_name IS NULL OR _product_name = '' THEN
        _product_name := _fragment_item->>'product_name';
      END IF;
      _variant_name := COALESCE(_fragment_item->>'variantName', _fragment_item->>'variant_name', '');
      UPDATE public.order_items
         SET supplier_id = _supplier_id
         AND order_id = _id::text
         AND product_name = _product_name
         AND COALESCE(variant_name, '') = _variant_name;
    END LOOP;
  END LOOP;
  RETURN _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb) TO anon, authenticated;
