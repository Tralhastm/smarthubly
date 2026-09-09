-- Permite que o painel sem login atualize apenas as ofertas do fornecedor
-- correspondente ao access_token presente no link privado do painel.
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_supplier_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _product_id AND tenant_id = v_supplier.tenant_id
  ) THEN
    RAISE EXCEPTION 'invalid_supplier_product';
  END IF;

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

CREATE OR REPLACE FUNCTION public.hide_stale_supplier_variant_offers_by_token(
  _token TEXT,
  _product_id TEXT,
  _incoming_keys TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id TEXT;
  v_count INTEGER;
BEGIN
  SELECT id INTO v_supplier_id
  FROM public.suppliers
  WHERE access_token = _token
    AND _token IS NOT NULL
    AND length(_token) >= 16;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_supplier_token';
  END IF;

  UPDATE public.supplier_variant_offers
  SET available = false, last_seen_at = now(), updated_at = now()
  WHERE supplier_id = v_supplier_id
    AND product_id = _product_id
    AND NOT (variant_key = ANY(COALESCE(_incoming_keys, ARRAY['__none__']::TEXT[])));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_supplier_variant_offer_by_token(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_supplier_variant_offer_by_token(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.hide_stale_supplier_variant_offers_by_token(TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hide_stale_supplier_variant_offers_by_token(TEXT, TEXT, TEXT[]) TO anon, authenticated;
