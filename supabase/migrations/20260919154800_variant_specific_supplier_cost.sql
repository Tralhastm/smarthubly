-- Allow a distinct supplier cost for each product variation.
DROP FUNCTION IF EXISTS public.import_supplier_catalog_atomic(text,text,jsonb);
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
        v_cost := NULLIF(variant->>'cost', '')::numeric;
        IF v_cost IS NULL THEN
          v_cost := NULLIF(item->>'cost', '')::numeric;
        END IF;
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

GRANT EXECUTE ON FUNCTION public.import_supplier_catalog_atomic(text,text,jsonb) TO anon, authenticated;
