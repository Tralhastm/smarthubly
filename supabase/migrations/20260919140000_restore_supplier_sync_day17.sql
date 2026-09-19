-- Restore supplier synchronization semantics from the stable 2026-09-17 behavior.
-- This is a forward migration: it does not delete products, variants, offers, or history.

CREATE OR REPLACE FUNCTION public.upsert_supplier_variant_offer_by_token(
  _token TEXT,
  _product_id TEXT,
  _product_variant_id TEXT,
  _variant_name TEXT,
  _variant_key TEXT,
  _unit_cost NUMERIC,
  _available BOOLEAN,
  _source TEXT DEFAULT 'supplier_panel'
)
RETURNS public.supplier_variant_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier public.suppliers%ROWTYPE;
  v_offer public.supplier_variant_offers;
BEGIN
  SELECT * INTO v_supplier
  FROM public.suppliers
  WHERE access_token = _token
    AND _token IS NOT NULL
    AND length(_token) >= 16;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _product_id AND tenant_id = v_supplier.tenant_id
  ) THEN RAISE EXCEPTION 'invalid_supplier_product'; END IF;
  INSERT INTO public.supplier_variant_offers (
    tenant_id, product_id, product_variant_id, supplier_id,
    variant_name, variant_key, unit_cost, available, source, last_seen_at
  ) VALUES (
    v_supplier.tenant_id, _product_id, _product_variant_id, v_supplier.id,
    _variant_name, _variant_key, _unit_cost, _available,
    COALESCE(_source, 'supplier_panel'), now()
  )
  ON CONFLICT (supplier_id, product_id, variant_key) DO UPDATE SET
    product_variant_id = EXCLUDED.product_variant_id,
    variant_name = EXCLUDED.variant_name,
    unit_cost = EXCLUDED.unit_cost,
    available = EXCLUDED.available,
    source = EXCLUDED.source,
    last_seen_at = now(),
    updated_at = now()
  RETURNING * INTO v_offer;
  RETURN v_offer;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_supplier_product_price_by_token(
  _token text,
  _product_name text,
  _unit_price numeric,
  _source_archive_id uuid DEFAULT NULL
)
RETURNS public.supplier_product_prices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier public.suppliers%ROWTYPE;
  v_row public.supplier_product_prices;
BEGIN
  SELECT * INTO v_supplier
  FROM public.suppliers
  WHERE access_token = _token
    AND _token IS NOT NULL
    AND length(_token) >= 16;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
  INSERT INTO public.supplier_product_prices(
    supplier_id, product_name, unit_price,
    price_types, available, source_archive_id
  ) VALUES (
    v_supplier.id, lower(trim(_product_name)),
    _unit_price, '["cost"]'::jsonb, true, _source_archive_id
  )
  ON CONFLICT(supplier_id, product_name) DO UPDATE SET
    unit_price = EXCLUDED.unit_price,
    price_types = EXCLUDED.price_types,
    available = true,
    source_archive_id = COALESCE(EXCLUDED.source_archive_id, supplier_product_prices.source_archive_id),
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_supplier_catalog_snapshot_by_token(
  _token text,
  _product_ids text[],
  _product_names text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id text;
  v_prices integer;
  v_offers integer;
BEGIN
  SELECT id INTO v_supplier_id
  FROM public.suppliers
  WHERE access_token = _token
    AND _token IS NOT NULL
    AND length(_token) >= 16;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;
  UPDATE public.supplier_product_prices
  SET available = false, updated_at = now()
  WHERE supplier_id = v_supplier_id
    AND NOT (lower(trim(product_name)) = ANY(COALESCE(_product_names, ARRAY['__none__']::text[])));
  GET DIAGNOSTICS v_prices = ROW_COUNT;
  UPDATE public.supplier_variant_offers
  SET available = false, last_seen_at = now(), updated_at = now()
  WHERE supplier_id = v_supplier_id
    AND NOT (product_id = ANY(COALESCE(_product_ids, ARRAY['__none__']::text[])));
  GET DIAGNOSTICS v_offers = ROW_COUNT;
  RETURN jsonb_build_object('prices_disabled', v_prices, 'offers_disabled', v_offers);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_supplier_catalog(p_supplier_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id TEXT;
  v_products INTEGER := 0;
  v_variants INTEGER := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.suppliers WHERE id=p_supplier_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'supplier_not_found'; END IF;
  WITH winner AS (
    SELECT DISTINCT ON (svo.product_variant_id)
      svo.product_variant_id,svo.supplier_id,svo.unit_cost
    FROM public.supplier_variant_offers svo
    JOIN public.suppliers s ON s.id=svo.supplier_id AND s.tenant_id=v_tenant_id
    WHERE svo.tenant_id=v_tenant_id AND svo.available=true AND svo.product_variant_id IS NOT NULL
    ORDER BY svo.product_variant_id,svo.unit_cost ASC,svo.updated_at DESC
  ), target AS (
    SELECT pv.id,p.price,pv.price_delta,pv.allow_loss,pv.suggested_price,
      w.supplier_id AS winner_supplier_id,w.unit_cost AS winner_cost
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id
    LEFT JOIN winner w ON w.product_variant_id=pv.id
    WHERE pv.tenant_id=v_tenant_id
  )
  UPDATE public.product_variants pv SET
    supplier_id=t.winner_supplier_id,
    cost_price=t.winner_cost,
    price_source=CASE WHEN t.winner_supplier_id IS NULL THEN NULL ELSE 'supplier_offer' END,
    in_stock=CASE
      WHEN t.winner_supplier_id IS NULL THEN false
      WHEN t.allow_loss THEN true
      ELSE (COALESCE(t.price+t.price_delta,t.price,0)
        -(COALESCE(t.price+t.price_delta,t.price,0)*0.0499)-50-10-t.winner_cost)>=0
    END,
    needs_price_review=CASE WHEN t.winner_supplier_id IS NULL THEN false ELSE COALESCE(t.suggested_price,0)<=0 END,
    updated_at=now()
  FROM target t WHERE pv.id=t.id;
  GET DIAGNOSTICS v_variants=ROW_COUNT;
  UPDATE public.products p SET
    supplier_id=NULL,
    in_stock=EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id AND pv.in_stock::text='true'),
    updated_at=now()
  WHERE p.tenant_id=v_tenant_id AND EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id);
  WITH winner AS (
    SELECT DISTINCT ON (p.id) p.id AS product_id,spp.supplier_id,spp.unit_price
    FROM public.products p
    JOIN public.supplier_product_prices spp ON spp.available=true
      AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name)
    JOIN public.suppliers s ON s.id=spp.supplier_id AND s.tenant_id=p.tenant_id
    WHERE p.tenant_id=v_tenant_id
      AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id)
    ORDER BY p.id,spp.unit_price ASC,spp.updated_at DESC
  )
  UPDATE public.products p SET
    supplier_id=w.supplier_id,
    original_price=w.unit_price,
    in_stock=CASE WHEN p.allow_loss THEN true ELSE
      (COALESCE(p.price,0)-(COALESCE(p.price,0)*0.0499)-50-10-w.unit_price)>=0 END,
    updated_at=now()
  FROM winner w WHERE p.id=w.product_id;
  GET DIAGNOSTICS v_products=ROW_COUNT;
  UPDATE public.products p SET supplier_id=NULL,original_price=NULL,in_stock=false,updated_at=now()
  WHERE p.tenant_id=v_tenant_id
    AND NOT EXISTS(SELECT 1 FROM public.product_variants pv WHERE pv.product_id=p.id)
    AND NOT EXISTS(
      SELECT 1 FROM public.supplier_product_prices spp
      JOIN public.suppliers s ON s.id=spp.supplier_id AND s.tenant_id=p.tenant_id
      WHERE spp.available=true
        AND public.catalog_product_match_key(spp.product_name)=public.catalog_product_match_key(p.name)
    );
  RETURN jsonb_build_object('products',v_products,'variants',v_variants,'checkout_fee',0.0499);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_supplier_variant_offer_by_token(text,text,text,text,text,numeric,boolean,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_supplier_product_price_by_token(text,text,numeric,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_supplier_catalog_snapshot_by_token(text,text[],text[]) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(text) TO service_role;
