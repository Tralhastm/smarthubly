-- Finaliza a correção do roteamento por menor custo no RPC do checkout.
-- Não altera criação, confirmação ou captura de pagamentos.
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

  IF position('<<checkout_fn>>' in ddl) = 0 THEN
    ddl := replace(ddl, E'AS $function$\nDECLARE', E'AS $function$\n<<checkout_fn>>\nDECLARE');
  END IF;
  ddl := replace(ddl, 'lower(variant_name)', 'lower(checkout_fn.variant_name)');
  ddl := replace(ddl, 'public.catalog_product_match_key(product_name)', 'public.catalog_product_match_key(checkout_fn.product_name)');
  ddl := replace(ddl, ' || product_name)', ' || checkout_fn.product_name)');
  ddl := replace(ddl, 'oi.order_id = order_id', 'oi.order_id = checkout_fn.order_id');
  ddl := replace(ddl, 'o.tenant_id = (_order->>''tenant_id'')', 'o.tenant_id::text = (_order->>''tenant_id'')');
  ddl := replace(ddl, 's.tenant_id = (_order->>''tenant_id'')', 's.tenant_id::text = (_order->>''tenant_id'')');

  EXECUTE ddl;
END $$;

NOTIFY pgrst, 'reload schema';
