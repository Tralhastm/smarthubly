CREATE TABLE IF NOT EXISTS public.supplier_catalog_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 days')
);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_archives_tenant_expiry
  ON public.supplier_catalog_archives (tenant_id, expires_at DESC);

ALTER TABLE public.supplier_catalog_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read supplier catalog archives"
  ON public.supplier_catalog_archives FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = supplier_catalog_archives.tenant_id AND ur.role = 'admin') OR EXISTS (SELECT 1 FROM public.platform_roles pr WHERE pr.user_id = auth.uid() AND pr.role = 'super_admin'));

CREATE POLICY "Admins can insert supplier catalog archives"
  ON public.supplier_catalog_archives FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = supplier_catalog_archives.tenant_id AND ur.role = 'admin') OR EXISTS (SELECT 1 FROM public.platform_roles pr WHERE pr.user_id = auth.uid() AND pr.role = 'super_admin'));

CREATE OR REPLACE FUNCTION public.cleanup_expired_supplier_catalog_archives()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM public.supplier_catalog_archives WHERE expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_supplier_catalog(
  p_tenant_id TEXT,
  p_supplier_name TEXT,
  p_file_name TEXT,
  p_content TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE archive_id UUID;
BEGIN
  PERFORM public.cleanup_expired_supplier_catalog_archives();
  INSERT INTO public.supplier_catalog_archives (tenant_id, supplier_name, file_name, content)
  VALUES (p_tenant_id, COALESCE(p_supplier_name, ''), COALESCE(p_file_name, ''), COALESCE(p_content, ''))
  RETURNING id INTO archive_id;
  RETURN archive_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_supplier_catalog(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_supplier_catalog_archives() TO authenticated;
