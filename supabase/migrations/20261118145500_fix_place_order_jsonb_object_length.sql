-- PostgreSQL has jsonb_object_keys/jsonb_array_length, but no built-in
-- jsonb_object_length. place_order uses this helper to count supplier fragments.
CREATE OR REPLACE FUNCTION public.jsonb_object_length(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT count(*)::integer
  FROM pg_catalog.jsonb_object_keys(p_value);
$function$;

COMMENT ON FUNCTION public.jsonb_object_length(jsonb) IS
  'Internal compatibility helper: count top-level JSON object keys for place_order.';

REVOKE ALL ON FUNCTION public.jsonb_object_length(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonb_object_length(jsonb) TO postgres;
