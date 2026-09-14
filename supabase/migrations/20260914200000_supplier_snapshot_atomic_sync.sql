-- Sincroniza o snapshot somente depois que o painel terminou de processar
-- as entradas. Assim uma falha no meio não desativa o catálogo inteiro.
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

GRANT EXECUTE ON FUNCTION public.sync_supplier_catalog_snapshot_by_token(text,text[],text[])
  TO anon, authenticated;
