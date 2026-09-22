-- Desambigua a variável order_id no UPDATE de order_items.
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
  ddl := replace(ddl, 'oi.order_id=order_id', 'oi.order_id=checkout_fn.order_id');
  EXECUTE ddl;
END $$;

NOTIFY pgrst, 'reload schema';
