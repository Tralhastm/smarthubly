-- Blindagem de estoque de fornecedor:
-- uma oferta só pode liberar venda se estiver disponível e vinculada
-- a uma lista temporária ainda válida. Histórico antigo permanece salvo,
-- mas não participa da vitrine nem do checkout.

ALTER TABLE public.supplier_product_prices
  ADD COLUMN IF NOT EXISTS source_archive_id UUID REFERENCES public.supplier_catalog_archives(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.reconcile_supplier_catalog(p_supplier_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id TEXT; v_products INTEGER := 0; v_variants INTEGER := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.suppliers WHERE id=p_supplier_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'supplier_not_found'; END IF;

  WITH winner AS (
    SELECT DISTINCT ON (svo.product_variant_id)
      svo.product_variant_id,svo.supplier_id,svo.unit_cost
    FROM public.supplier_variant_offers svo
    JOIN public.suppliers s ON s.id=svo.supplier_id AND s.tenant_id=v_tenant_id
    JOIN public.supplier_catalog_archives a ON a.id=svo.source_archive_id
      AND a.expires_at > now()
    WHERE svo.tenant_id=v_tenant_id AND svo.available=true
      AND svo.product_variant_id IS NOT NULL
    ORDER BY svo.product_variant_id,svo.unit_cost ASC,svo.updated_at DESC
  ), target AS (
    SELECT pv.id,p.price,pv.price_delta,pv.allow_loss,pv.suggested_price,
      w.supplier_id AS winner_supplier_id,w.unit_cost AS winner_cost
    FROM public.product_variants pv JOIN public.products p ON p.id=pv.product_id
    LEFT JOIN winner w ON w.product_variant_id=pv.id WHERE pv.tenant_id=v_tenant_id
  )
  UPDATE public.product_variants pv SET
    supplier_id=t.winner_supplier_id,
    cost_price=t.winner_cost,
    price_source=CASE WHEN t.winner_supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
    in_stock=CASE WHEN t.winner_supplier_id IS NULL THEN false WHEN t.allow_loss THEN true
      ELSE (COALESCE(t.price+COALESCE(t.price_delta,0),t.price,0)
        -(COALESCE(t.price+COALESCE(t.price_delta,0),t.price,0)*0.0499)-50-10-t.winner_cost)>=0 END,
    needs_price_review=CASE WHEN t.winner_supplier_id IS NULL THEN false ELSE COALESCE(t.suggested_price,0)<=0 END,
    updated_at=now() FROM target t WHERE pv.id=t.id;
  GET DIAGNOSTICS v_variants=ROW_COUNT;

  UPDATE public.products p SET supplier_id=NULL,
    in_stock=EXISTS(SELECT 1 FROM public.product_variants pv
      WHERE pv.product_id=p.id AND pv.in_stock::text='true'),
    updated_at=now()
  WHERE p.tenant_id=v_tenant_id
    AND EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id);

  WITH winner AS (
    SELECT DISTINCT ON (p.id) p.id AS product_id,spp.supplier_id,spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp ON spp.available=true
    JOIN public.supplier_catalog_archives a ON a.id=spp.source_archive_id AND a.expires_at > now()
    JOIN public.suppliers s ON s.id=spp.supplier_id AND s.tenant_id=p.tenant_id
    WHERE p.tenant_id=v_tenant_id
      AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name)
      AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id)
    ORDER BY p.id,spp.unit_price ASC,spp.updated_at DESC
  )
  UPDATE public.products p SET supplier_id=w.supplier_id,original_price=w.unit_price,
    in_stock=CASE WHEN p.allow_loss THEN true ELSE (COALESCE(p.price,0)
      -(COALESCE(p.price,0)*0.0499)-50-10-w.unit_price)>=0 END,updated_at=now()
    FROM winner w WHERE p.id=w.product_id;
  GET DIAGNOSTICS v_products=ROW_COUNT;

  UPDATE public.products p SET supplier_id=NULL,original_price=NULL,in_stock=false,updated_at=now()
  WHERE p.tenant_id=v_tenant_id AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id)
    AND NOT EXISTS(
      SELECT 1 FROM public.supplier_product_prices spp
      JOIN public.suppliers s ON s.id=spp.supplier_id AND s.tenant_id=p.tenant_id
      JOIN public.supplier_catalog_archives a ON a.id=spp.source_archive_id AND a.expires_at > now()
      WHERE spp.available=true
        AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name));
  RETURN jsonb_build_object('products',v_products,'variants',v_variants);
END; $$;

CREATE OR REPLACE FUNCTION public.place_order(_order jsonb, _items jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid; _payload jsonb; _cols text; _it jsonb; _fragment_pair record;
  _fragment_item jsonb; _supplier_id text; _fragment_items jsonb; _fragment_total numeric;
  _product_name text; _variant_name text; _tenant_id text; _product_id uuid; _variant_id uuid;
  _has_variants boolean; _valid_offer boolean;
BEGIN
  _tenant_id := _order->>'tenant_id';
  IF _tenant_id IS NULL OR _tenant_id = '' THEN RAISE EXCEPTION 'tenant_required'; END IF;

  -- Última barreira: cada item precisa estar coberto por uma oferta atual.
  FOR _it IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    _product_name := NULLIF(trim(_it->>'product_name'),'');
    _variant_name := lower(trim(coalesce(_it->>'variant_name','')));
    SELECT p.id INTO _product_id FROM public.products p
      WHERE p.tenant_id=_tenant_id AND lower(trim(p.name))=lower(_product_name) LIMIT 1;
    IF _product_id IS NULL THEN RAISE EXCEPTION 'item_indisponivel: %', _product_name; END IF;
    SELECT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=_product_id) INTO _has_variants;
    IF _has_variants AND _variant_name <> '' THEN
      SELECT pv.id INTO _variant_id FROM public.product_variants pv
        WHERE pv.product_id=_product_id AND lower(trim(pv.name))=_variant_name AND pv.in_stock::text='true' LIMIT 1;
      IF _variant_id IS NULL THEN RAISE EXCEPTION 'variacao_indisponivel: % / %', _product_name, _it->>'variant_name'; END IF;
      SELECT EXISTS(SELECT 1 FROM public.supplier_variant_offers svo
        JOIN public.supplier_catalog_archives a ON a.id=svo.source_archive_id AND a.expires_at > now()
        WHERE svo.tenant_id=_tenant_id AND svo.product_variant_id=_variant_id AND svo.available=true) INTO _valid_offer;
    ELSE
      SELECT EXISTS(SELECT 1 FROM public.supplier_product_prices spp
        JOIN public.supplier_catalog_archives a ON a.id=spp.source_archive_id AND a.expires_at > now()
        JOIN public.suppliers s ON s.id=spp.supplier_id AND s.tenant_id=_tenant_id
        WHERE spp.available=true
          AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(_product_name)) INTO _valid_offer;
    END IF;
    IF NOT _valid_offer THEN RAISE EXCEPTION 'fornecedor_sem_estoque_atual: % / %', _product_name, COALESCE(_it->>'variant_name',''); END IF;
  END LOOP;

  _payload := (SELECT jsonb_object_agg(k, v) FROM jsonb_each(_order - 'id' - 'created_at' - 'updated_at') AS t(k, v)
    WHERE v <> 'null'::jsonb AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='orders' AND c.column_name=k));
  SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;
  EXECUTE format('INSERT INTO public.orders (%s) SELECT %s FROM jsonb_populate_record(null::public.orders, $1) RETURNING id', _cols, _cols) USING _payload INTO _id;
  FOR _it IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    _payload := (SELECT jsonb_object_agg(k, v) FROM jsonb_each((_it - 'id' - 'created_at') || jsonb_build_object('order_id', _id)) AS t(k, v)
      WHERE EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='order_items' AND c.column_name=k));
    SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;
    EXECUTE format('INSERT INTO public.order_items (%s) SELECT %s FROM jsonb_populate_record(null::public.order_items, $1)', _cols, _cols) USING _payload;
  END LOOP;
  FOR _fragment_pair IN SELECT key AS supplier_id, value AS items FROM jsonb_each(COALESCE(_order->'metadata'->'fragmentation_map','{}'::jsonb)) LOOP
    _supplier_id := _fragment_pair.supplier_id; _fragment_items := COALESCE(_fragment_pair.items,'[]'::jsonb);
    INSERT INTO public.order_fragments(order_id,tenant_id,supplier_id,items,total,status)
      VALUES (_id::text,_tenant_id,_supplier_id,_fragment_items,COALESCE((SELECT SUM(COALESCE((item->>'quantity')::numeric,0)*COALESCE((item->>'product_price')::numeric,0)) FROM jsonb_array_elements(_fragment_items) AS x(item)),0),_order->>'status');
    FOR _fragment_item IN SELECT * FROM jsonb_array_elements(_fragment_items) LOOP
      _product_name := COALESCE(_fragment_item->'product'->>'name',_fragment_item->>'product_name');
      _variant_name := COALESCE(_fragment_item->>'variantName',_fragment_item->>'variant_name','');
      UPDATE public.order_items SET supplier_id=_supplier_id WHERE order_id=_id AND product_name=_product_name AND COALESCE(variant_name,'')=_variant_name;
    END LOOP;
  END LOOP;
  RETURN _id;
END; $$;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(TEXT) TO authenticated,service_role;

-- Corrige imediatamente produtos-pai sem variante que ficaram disponíveis
-- fora de uma lista temporária válida.
UPDATE public.products p SET supplier_id=NULL, original_price=NULL, in_stock=false, updated_at=now()
WHERE p.in_stock::text='true' AND NOT EXISTS (
  SELECT 1 FROM public.supplier_product_prices spp
  JOIN public.supplier_catalog_archives a ON a.id=spp.source_archive_id AND a.expires_at > now()
  WHERE spp.available=true
    AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name));

UPDATE public.product_variants pv SET in_stock=false, supplier_id=NULL, cost_price=NULL, price_source=NULL, updated_at=now()
WHERE pv.in_stock::text='true' AND NOT EXISTS (
  SELECT 1 FROM public.supplier_variant_offers svo
  JOIN public.supplier_catalog_archives a ON a.id=svo.source_archive_id AND a.expires_at > now()
  WHERE svo.available=true AND svo.product_variant_id=pv.id);

UPDATE public.products p SET in_stock=EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id AND pv.in_stock::text='true')
WHERE EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id);
