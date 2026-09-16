-- Fornecedor não é dono fixo do produto. Ele precisa consultar o catálogo
-- completo da loja para registrar sua própria oferta; a reconciliação escolhe
-- depois o menor custo vigente entre os fornecedores.
CREATE OR REPLACE FUNCTION public.get_supplier_catalog_by_token(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.suppliers
  WHERE access_token = _token
    AND _token IS NOT NULL
    AND length(_token) >= 16;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_supplier_token';
  END IF;

  RETURN jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) - 'tenant_id' - 'description' - 'image_url')
      FROM public.products p
      WHERE p.tenant_id = v_tenant_id
    ), '[]'::jsonb),
    'variants', COALESCE((
      SELECT jsonb_agg(to_jsonb(v) - 'tenant_id')
      FROM public.product_variants v
      WHERE v.tenant_id = v_tenant_id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_catalog_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_catalog_by_token(TEXT) TO anon, authenticated;
