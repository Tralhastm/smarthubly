ALTER TABLE public.supplier_variant_offers
  ADD COLUMN IF NOT EXISTS match_confidence NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS match_reason TEXT NOT NULL DEFAULT 'matching_deterministico',
  ADD COLUMN IF NOT EXISTS source_archive_id UUID REFERENCES public.supplier_catalog_archives(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.supplier_catalog_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES public.suppliers(id) ON DELETE SET NULL,
  product_id TEXT REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id TEXT REFERENCES public.product_variants(id) ON DELETE SET NULL,
  source_archive_id UUID REFERENCES public.supplier_catalog_archives(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  old_cost NUMERIC,
  new_cost NUMERIC,
  old_available BOOLEAN,
  new_available BOOLEAN,
  match_confidence NUMERIC(5,4),
  match_reason TEXT,
  raw_line TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_audit_tenant_created
  ON public.supplier_catalog_audit(tenant_id, created_at DESC);
ALTER TABLE public.supplier_catalog_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read supplier catalog audit" ON public.supplier_catalog_audit;
CREATE POLICY "Admins can read supplier catalog audit" ON public.supplier_catalog_audit
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.tenant_id=supplier_catalog_audit.tenant_id AND ur.role='admin') OR EXISTS (SELECT 1 FROM public.platform_roles pr WHERE pr.user_id=auth.uid() AND pr.role='super_admin'));

CREATE OR REPLACE FUNCTION public.audit_supplier_variant_offer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.supplier_catalog_audit(tenant_id,supplier_id,product_id,product_variant_id,source_archive_id,action,old_cost,new_cost,old_available,new_available,match_confidence,match_reason)
  VALUES (COALESCE(NEW.tenant_id,OLD.tenant_id),COALESCE(NEW.supplier_id,OLD.supplier_id),COALESCE(NEW.product_id,OLD.product_id),COALESCE(NEW.product_variant_id,OLD.product_variant_id),COALESCE(NEW.source_archive_id,OLD.source_archive_id),TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.unit_cost END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.unit_cost END,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.available END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.available END,COALESCE(NEW.match_confidence,OLD.match_confidence),COALESCE(NEW.match_reason,OLD.match_reason));
  RETURN COALESCE(NEW,OLD);
END; $$;
DROP TRIGGER IF EXISTS supplier_variant_offer_audit_trigger ON public.supplier_variant_offers;
CREATE TRIGGER supplier_variant_offer_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON public.supplier_variant_offers FOR EACH ROW EXECUTE FUNCTION public.audit_supplier_variant_offer();
