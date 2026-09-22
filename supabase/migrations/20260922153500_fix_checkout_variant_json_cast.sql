-- Corrige a leitura de variantName no RPC público do checkout.
-- it->'variantName' retorna jsonb e causava falha de COALESCE com textos.
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

  ddl := replace(ddl, 'it->''variantName''', 'it->>''variantName''');
  EXECUTE ddl;
END $$;

NOTIFY pgrst, 'reload schema';
