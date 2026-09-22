-- Desambigua a variável product_name das colunas SQL no caminho sem variante.
DO $$
DECLARE
  ddl text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO ddl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'place_order'
    AND pg_get_function_identity_arguments(p.oid) = '_order jsonb, _items jsonb';

  IF ddl IS NULL THEN
    RAISE EXCEPTION 'place_order não encontrado';
  END IF;

  ddl := replace(ddl, 'AS $function$ DECLARE', 'AS $function$ <<checkout_fn>> DECLARE');
  ddl := replace(ddl, 'public.catalog_product_match_key(product_name)', 'public.catalog_product_match_key(checkout_fn.product_name)');
  ddl := replace(ddl, 'md5(spp.supplier_id::text||'':''||product_name)', 'md5(spp.supplier_id::text||'':''||checkout_fn.product_name)');
  EXECUTE ddl;
END $$;

NOTIFY pgrst, 'reload schema';
