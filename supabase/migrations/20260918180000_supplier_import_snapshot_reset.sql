CREATE OR REPLACE FUNCTION public.begin_supplier_catalog_snapshot_by_token(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_supplier_id TEXT; v_prices INTEGER; v_variants INTEGER;
BEGIN
  SELECT id INTO v_supplier_id FROM public.suppliers
  WHERE access_token = _token AND _token IS NOT NULL AND length(_token) >= 16;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;

  UPDATE public.supplier_product_prices
  SET available=false, updated_at=now()
  WHERE supplier_id=v_supplier_id;
  GET DIAGNOSTICS v_prices=ROW_COUNT;

  UPDATE public.supplier_variant_offers
  SET available=false, last_seen_at=now(), updated_at=now()
  WHERE supplier_id=v_supplier_id;
  GET DIAGNOSTICS v_variants=ROW_COUNT;

  RETURN jsonb_build_object('prices_disabled',v_prices,'offers_disabled',v_variants);
END;
$$;
GRANT EXECUTE ON FUNCTION public.begin_supplier_catalog_snapshot_by_token(TEXT) TO anon, authenticated;
