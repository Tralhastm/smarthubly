
-- Driver lookup by token (used in /loja/{slug}/motoboy/{token})
CREATE OR REPLACE FUNCTION public.get_driver_by_token(_token text)
RETURNS SETOF public.drivers
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.drivers WHERE access_token = _token AND _token IS NOT NULL AND length(_token) >= 16 LIMIT 1;
$$;

-- Supplier lookup by token
CREATE OR REPLACE FUNCTION public.get_supplier_by_token(_token text)
RETURNS SETOF public.suppliers
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.suppliers WHERE access_token = _token AND _token IS NOT NULL AND length(_token) >= 16 LIMIT 1;
$$;

-- Waiter lookup by tenant slug + token
CREATE OR REPLACE FUNCTION public.get_waiter_by_token(_tenant_id uuid, _token text)
RETURNS SETOF public.waiters
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.waiters
   WHERE tenant_id = _tenant_id AND access_token = _token AND active = true
     AND _token IS NOT NULL AND length(_token) >= 16
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_driver_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_waiter_by_token(uuid, text) TO anon, authenticated;

-- Drop the wide-open anon read on drivers now that RPC exists
DROP POLICY IF EXISTS "Anon can read drivers (token is the secret)" ON public.drivers;
