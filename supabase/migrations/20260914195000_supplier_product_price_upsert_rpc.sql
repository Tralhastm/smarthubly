-- O painel do fornecedor usa token, não sessão de usuário autenticada.
-- A gravação auxiliar precisa ocorrer via SECURITY DEFINER para não falhar por RLS.
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
    tenant_id, supplier_id, product_name, unit_price,
    price_types, available, source_archive_id
  ) VALUES (
    v_supplier.tenant_id, v_supplier.id, lower(trim(_product_name)),
    _unit_price, ARRAY['cost']::text[], true, _source_archive_id
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

GRANT EXECUTE ON FUNCTION public.upsert_supplier_product_price_by_token(text,text,numeric,uuid)
  TO anon, authenticated;
