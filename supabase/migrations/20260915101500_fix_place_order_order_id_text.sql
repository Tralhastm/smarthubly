-- Corrige o checkout quando há fragmentação por fornecedor.
-- orders.id e order_items.order_id são TEXT nesta instalação; comparar com
-- _id (UUID) gera erro de operador e desfaz o pedido inteiro.
CREATE OR REPLACE FUNCTION public.place_order(_order jsonb, _items jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id text; _payload jsonb; _cols text; _it jsonb; _fragment_pair record;
  _fragment_item jsonb; _supplier_id text; _fragment_items jsonb; _product_name text;
  _variant_name text; _tenant_id text; _product_id text; _variant_id text;
  _has_variants boolean; _valid_offer boolean;
BEGIN
  _tenant_id := _order->>'tenant_id';
  IF _tenant_id IS NULL OR _tenant_id = '' THEN RAISE EXCEPTION 'tenant_required'; END IF;

  FOR _it IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    _product_name := NULLIF(trim(_it->>'product_name'), '');
    _variant_name := lower(trim(coalesce(_it->>'variant_name', '')));
    SELECT p.id INTO _product_id FROM public.products p
      WHERE p.tenant_id = _tenant_id AND lower(trim(p.name)) = lower(_product_name) LIMIT 1;
    IF _product_id IS NULL THEN RAISE EXCEPTION 'item_indisponivel: %', _product_name; END IF;
    SELECT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id = _product_id) INTO _has_variants;
    IF _has_variants AND _variant_name <> '' THEN
      SELECT pv.id INTO _variant_id FROM public.product_variants pv
        WHERE pv.product_id = _product_id AND lower(trim(pv.name)) = _variant_name AND pv.in_stock::text = 'true' LIMIT 1;
      IF _variant_id IS NULL THEN RAISE EXCEPTION 'variacao_indisponivel: % / %', _product_name, _it->>'variant_name'; END IF;
      SELECT EXISTS(SELECT 1 FROM public.supplier_variant_offers svo
        WHERE svo.tenant_id = _tenant_id AND svo.product_variant_id = _variant_id AND svo.available = true) INTO _valid_offer;
    ELSE
      SELECT EXISTS(SELECT 1 FROM public.supplier_product_prices spp
        JOIN public.suppliers s ON s.id = spp.supplier_id AND s.tenant_id = _tenant_id
        WHERE spp.available = true
          AND public.catalog_product_match_key(spp.product_name) = public.catalog_product_match_key(_product_name)) INTO _valid_offer;
    END IF;
    IF NOT _valid_offer THEN RAISE EXCEPTION 'fornecedor_sem_estoque_atual: % / %', _product_name, COALESCE(_it->>'variant_name', ''); END IF;
  END LOOP;

  _payload := (SELECT jsonb_object_agg(k, v) FROM jsonb_each(_order - 'id' - 'created_at' - 'updated_at') AS t(k, v)
    WHERE v <> 'null'::jsonb AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'orders' AND c.column_name = k));
  SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;
  EXECUTE format('INSERT INTO public.orders (%s) SELECT %s FROM jsonb_populate_record(null::public.orders, $1) RETURNING id', _cols, _cols) USING _payload INTO _id;

  FOR _it IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    _payload := (SELECT jsonb_object_agg(k, v) FROM jsonb_each((_it - 'id' - 'created_at') || jsonb_build_object('order_id', _id::text)) AS t(k, v)
      WHERE EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'order_items' AND c.column_name = k));
    SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;
    EXECUTE format('INSERT INTO public.order_items (%s) SELECT %s FROM jsonb_populate_record(null::public.order_items, $1)', _cols, _cols) USING _payload;
  END LOOP;

  FOR _fragment_pair IN SELECT key AS supplier_id, value AS items FROM jsonb_each(COALESCE(_order->'metadata'->'fragmentation_map', '{}'::jsonb)) LOOP
    _supplier_id := _fragment_pair.supplier_id; _fragment_items := COALESCE(_fragment_pair.items, '[]'::jsonb);
    INSERT INTO public.order_fragments(order_id, tenant_id, supplier_id, items, total, status)
      VALUES (_id::text, _tenant_id, _supplier_id, _fragment_items, COALESCE((SELECT SUM(COALESCE((item->>'quantity')::numeric, 0) * COALESCE((item->>'product_price')::numeric, 0)) FROM jsonb_array_elements(_fragment_items) AS x(item)), 0), _order->>'status');
    FOR _fragment_item IN SELECT * FROM jsonb_array_elements(_fragment_items) LOOP
      _product_name := COALESCE(_fragment_item->'product'->>'name', _fragment_item->>'product_name');
      _variant_name := COALESCE(_fragment_item->>'variantName', _fragment_item->>'variant_name', '');
      UPDATE public.order_items SET supplier_id = _supplier_id WHERE order_id = _id::text AND product_name = _product_name AND COALESCE(variant_name, '') = _variant_name;
    END LOOP;
  END LOOP;
  RETURN _id::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb) TO anon, authenticated;
