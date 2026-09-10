-- Permite que administradores autenticados acionem a reconciliação após cada upload.
-- A função existente continua SECURITY DEFINER e valida o fornecedor/tenant.
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_catalog(TEXT) TO authenticated;
