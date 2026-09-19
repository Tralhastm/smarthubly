-- Blindagem do catálogo de fornecedores.
-- A lista recebida é a única fonte de disponibilidade do fornecedor no snapshot atual.
-- A importação inteira é atômica: qualquer produto/variação ambíguo aborta tudo.

CREATE OR REPLACE FUNCTION public.rebuild_supplier_catalog_state(_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_products integer := 0;
  v_variants integer := 0;
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
      -- Uma variação nova só entra na lista de venda depois do preço de revenda manual.
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

  RETURN jsonb_build_object('products', v_products, 'variants', v_variants);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_supplier_catalog_atomic(
  _token text,
  _content text,
  _entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  s public.suppliers%ROWTYPE;
  archive_id uuid;
  snap_id uuid;
  item jsonb;
  variant jsonb;
  p_id text;
  p_name text;
  v_name text;
  v_key text;
  v_cost numeric;
  v_available boolean;
  variant_count integer;
  match_count integer;
  pv public.product_variants%ROWTYPE;
  product_count integer := 0;
  offer_count integer := 0;
  created_variant_count integer := 0;
BEGIN
  SELECT * INTO s
  FROM public.suppliers
  WHERE access_token = _token AND length(COALESCE(_token, '')) >= 16;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
  IF jsonb_typeof(COALESCE(_entries, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(_entries, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'empty_supplier_catalog';
  END IF;

  -- Arquivo e snapshot nascem juntos. Snapshots abandonados nunca voltam a ser fonte.
  INSERT INTO public.supplier_catalog_archives(tenant_id, supplier_name, file_name, content)
  VALUES (s.tenant_id, s.name, 'painel-fornecedor-' || s.name, COALESCE(_content, ''))
  RETURNING id INTO archive_id;

  UPDATE public.supplier_catalog_snapshots
  SET status = 'failed'
  WHERE supplier_id = s.id AND status = 'processing';

  INSERT INTO public.supplier_catalog_snapshots(tenant_id, supplier_id, archive_id, status)
  VALUES (s.tenant_id, s.id, archive_id, 'processing')
  RETURNING id INTO snap_id;

  FOR item IN SELECT value FROM jsonb_array_elements(_entries) LOOP
    p_id := NULLIF(trim(item->>'product_id'), '');
    p_name := NULLIF(trim(item->>'product_name'), '');
    IF p_id IS NULL OR p_name IS NULL THEN
      RAISE EXCEPTION 'invalid_supplier_entry';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_id AND tenant_id = s.tenant_id) THEN
      -- Produtos desconhecidos deveriam ser filtrados antes desta função.
      -- Bloquear aqui evita que uma entrada mal associada altere qualquer produto.
      RAISE EXCEPTION 'invalid_supplier_product: %', p_name;
    END IF;

    variant_count := jsonb_array_length(COALESCE(item->'variants', '[]'::jsonb));
    IF variant_count = 0 THEN
      v_cost := NULLIF(item->>'cost', '')::numeric;
      IF v_cost IS NULL OR v_cost <= 0 THEN
        RAISE EXCEPTION 'invalid_supplier_cost: %', p_name;
      END IF;
      INSERT INTO public.supplier_product_prices(
        supplier_id, product_name, unit_price, price_types, available, source_archive_id, snapshot_id
      ) VALUES (
        s.id, lower(trim(p_name)), v_cost, '["cost"]'::jsonb, true, archive_id, snap_id
      )
      ON CONFLICT (supplier_id, product_name) DO UPDATE SET
        unit_price = EXCLUDED.unit_price,
        price_types = EXCLUDED.price_types,
        available = true,
        source_archive_id = EXCLUDED.source_archive_id,
        snapshot_id = EXCLUDED.snapshot_id,
        updated_at = now();
      product_count := product_count + 1;
    ELSE
      FOR variant IN SELECT value FROM jsonb_array_elements(item->'variants') LOOP
        v_name := NULLIF(trim(variant->>'name'), '');
        IF v_name IS NULL THEN RAISE EXCEPTION 'invalid_supplier_variant: %', p_name; END IF;
        v_key := public.normalize_supplier_variant_key(v_name);
        IF v_key = '' THEN RAISE EXCEPTION 'invalid_supplier_variant: %', p_name; END IF;
        v_cost := NULLIF(item->>'cost', '')::numeric;
        IF v_cost IS NULL OR v_cost <= 0 THEN
          RAISE EXCEPTION 'invalid_supplier_cost: % / %', p_name, v_name;
        END IF;
        v_available := COALESCE((variant->>'available')::boolean, true);

        SELECT count(*) INTO match_count
        FROM public.product_variants
        WHERE product_id = p_id AND public.normalize_supplier_variant_key(name) = v_key;
        IF match_count > 1 THEN
          RAISE EXCEPTION 'ambiguous_supplier_variant: % / %', p_name, v_name;
        ELSIF match_count = 0 THEN
          INSERT INTO public.product_variants(
            product_id, tenant_id, name, price_delta, in_stock,
            suggested_price, needs_price_review, sort_order
          ) VALUES (
            p_id, s.tenant_id, v_name, 0, false, NULL, true,
            (SELECT COALESCE(max(sort_order), -1) + 1 FROM public.product_variants WHERE product_id = p_id)
          ) RETURNING * INTO pv;
          created_variant_count := created_variant_count + 1;
        ELSE
          SELECT * INTO pv
          FROM public.product_variants
          WHERE product_id = p_id AND public.normalize_supplier_variant_key(name) = v_key
          ORDER BY id LIMIT 1;
        END IF;

        INSERT INTO public.supplier_variant_offers(
          tenant_id, product_id, product_variant_id, supplier_id,
          variant_name, variant_key, unit_cost, available, source,
          last_seen_at, snapshot_id, source_archive_id, match_confidence, match_reason
        ) VALUES (
          s.tenant_id, p_id, pv.id, s.id, v_name, v_key, v_cost, v_available,
          'supplier_panel', now(), snap_id, archive_id, 1.0,
          'atomic_supplier_catalog_exact_normalized_match'
        )
        ON CONFLICT (supplier_id, product_id, variant_key) DO UPDATE SET
          product_variant_id = EXCLUDED.product_variant_id,
          variant_name = EXCLUDED.variant_name,
          unit_cost = EXCLUDED.unit_cost,
          available = EXCLUDED.available,
          source = EXCLUDED.source,
          last_seen_at = now(),
          snapshot_id = EXCLUDED.snapshot_id,
          source_archive_id = EXCLUDED.source_archive_id,
          match_confidence = 1.0,
          match_reason = EXCLUDED.match_reason,
          updated_at = now();
        offer_count := offer_count + 1;
      END LOOP;
    END IF;
  END LOOP;

  -- Tudo que não entrou no snapshot atual fica esgotado para este fornecedor.
  UPDATE public.supplier_variant_offers
  SET available = false, last_seen_at = now(), updated_at = now()
  WHERE supplier_id = s.id AND snapshot_id IS DISTINCT FROM snap_id;
  UPDATE public.supplier_product_prices
  SET available = false, updated_at = now()
  WHERE supplier_id = s.id AND snapshot_id IS DISTINCT FROM snap_id;

  UPDATE public.supplier_catalog_snapshots
  SET status = 'superseded'
  WHERE supplier_id = s.id AND status = 'completed';
  UPDATE public.supplier_catalog_snapshots
  SET status = 'completed', completed_at = now()
  WHERE id = snap_id;

  RETURN jsonb_build_object(
    'snapshot_id', snap_id,
    'archive_id', archive_id,
    'status', 'completed',
    'products', product_count,
    'offers', offer_count,
    'created_variants', created_variant_count,
    'reconciliation', public.rebuild_supplier_catalog_state(s.tenant_id)
  );
END;
$$;

-- O painel passa a usar exclusivamente a operação atômica. As primitivas antigas
-- ficam bloqueadas para evitar qualquer importação parcial por frontend antigo.
REVOKE ALL ON FUNCTION public.upsert_supplier_variant_offer_by_token(text,text,text,text,text,numeric,boolean,text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_supplier_product_price_by_token(text,text,numeric,uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_supplier_catalog_snapshot_by_token(text,text[],text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_supplier_catalog_atomic(text,text,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_supplier_catalog_state(text) TO service_role;

-- Corrige qualquer snapshot travado sem alterar ofertas: ele nunca pode ser operacional.
UPDATE public.supplier_catalog_snapshots
SET status = 'failed'
WHERE status = 'processing';

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM public.suppliers LOOP
    PERFORM public.rebuild_supplier_catalog_state(t);
  END LOOP;
END;
$$;
