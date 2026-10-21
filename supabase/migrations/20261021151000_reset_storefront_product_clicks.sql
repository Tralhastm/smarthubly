-- Remove apenas os cliques de abertura de detalhe registrados pela vitrine.
-- Cliques externos de afiliados (ip_hash preenchido) são preservados.
CREATE OR REPLACE FUNCTION public.reset_storefront_product_clicks(_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role, _tenant_id)
    OR public.has_platform_role(auth.uid(), 'super_admin'::public.platform_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized to reset storefront clicks'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.affiliate_clicks AS click
  WHERE click.tenant_id = _tenant_id::text
    AND click.ip_hash IS NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_storefront_product_clicks(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_storefront_product_clicks(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_storefront_product_clicks(uuid) TO authenticated;

COMMENT ON FUNCTION public.reset_storefront_product_clicks(uuid) IS
  'Admin-only reset of storefront product-detail clicks (ip_hash IS NULL); preserves external affiliate click records.';
