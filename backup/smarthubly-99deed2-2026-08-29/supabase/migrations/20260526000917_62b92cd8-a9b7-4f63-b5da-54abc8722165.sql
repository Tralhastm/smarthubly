
CREATE OR REPLACE FUNCTION public.get_tenant_public_by_slug(_slug text)
RETURNS SETOF public.tenants_public
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.tenants_public WHERE slug = _slug LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.get_tenant_pix(_tenant_id uuid)
RETURNS TABLE(pix_key text, pix_key_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT pix_key, pix_key_type FROM public.tenants WHERE id = _tenant_id; $$;

CREATE OR REPLACE FUNCTION public.get_supplier_lalamove_status(_supplier_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sup record; v_tenant_enabled boolean;
BEGIN
  SELECT * INTO v_sup FROM public.suppliers WHERE access_token = _supplier_token LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('available', false); END IF;
  SELECT lalamove_enabled INTO v_tenant_enabled FROM public.tenants WHERE id = v_sup.tenant_id;
  RETURN jsonb_build_object(
    'available',
    (v_sup.lalamove_api_key IS NOT NULL AND v_sup.lalamove_api_secret IS NOT NULL)
    OR (COALESCE(v_tenant_enabled,false) AND v_sup.lalamove_use_store_api = 'approved')
  );
END; $$;

CREATE OR REPLACE FUNCTION public.list_active_drivers_for_supplier(_supplier_token text)
RETURNS TABLE(id uuid, name text, phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.suppliers WHERE access_token = _supplier_token LIMIT 1;
  IF v_tenant IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT d.id, d.name, d.phone FROM public.drivers d
    WHERE d.tenant_id = v_tenant AND d.active = true;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public_by_slug(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_pix(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_lalamove_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_drivers_for_supplier(text) TO anon, authenticated;
