
CREATE OR REPLACE FUNCTION public.get_orders_by_phone(_tenant_id uuid, _phone text)
RETURNS SETOF public.orders_public
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT op.* FROM public.orders_public op
  JOIN public.orders o ON o.id = op.id
  WHERE o.tenant_id = _tenant_id AND o.customer_phone = _phone
  ORDER BY o.created_at DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_orders_by_phone(uuid, text) TO anon, authenticated;
