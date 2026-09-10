DROP FUNCTION IF EXISTS public.list_active_drivers_for_supplier(text);

CREATE OR REPLACE FUNCTION public.list_active_drivers_for_supplier(_supplier_token text)
RETURNS TABLE(id text, name text, phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT tenant_id::text INTO v_tenant
  FROM public.suppliers
  WHERE access_token = _supplier_token
  LIMIT 1;

  IF v_tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id::text, d.name::text, d.phone::text
  FROM public.drivers d
  WHERE d.tenant_id::text = v_tenant
    AND d.active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_active_drivers_for_supplier(text) TO anon, authenticated;
