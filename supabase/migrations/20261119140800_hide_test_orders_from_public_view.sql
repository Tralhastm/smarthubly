-- Hide explicitly marked test orders from public customer lookup.
-- Wrap the existing projection rather than redefining its columns: this keeps
-- the safe column contract, dependent RPC return type, grants and owner intact.
-- No order, item, event, chat or payment row is deleted or modified.
DO $migration$
DECLARE
  existing_view_definition text;
BEGIN
  SELECT pg_get_viewdef('public.orders_public'::regclass, true)
    INTO existing_view_definition;

  IF existing_view_definition IS NULL THEN
    RAISE EXCEPTION 'public.orders_public must exist before test-order filtering';
  END IF;

  existing_view_definition := regexp_replace(existing_view_definition, ';\s*$', '');

  EXECUTE format(
    'CREATE OR REPLACE VIEW public.orders_public WITH (security_invoker = false) AS '
    || 'SELECT p.* FROM (%s) AS p '
    || 'JOIN public.orders AS o ON o.id = p.id '
    || 'WHERE o.metadata->>''is_test_order'' IS DISTINCT FROM ''true''',
    existing_view_definition
  );
END;
$migration$;
