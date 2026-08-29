CREATE TABLE public.nfe_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  chave_nfe TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('xml','pdf','image')),
  source_filename TEXT,
  extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_adjustments JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','discarded')),
  apr_id UUID,
  supplier_id UUID,
  stock_movement_ids UUID[],
  imported_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfe_imports_tenant ON public.nfe_imports(tenant_id, created_at DESC);
CREATE UNIQUE INDEX idx_nfe_imports_chave ON public.nfe_imports(tenant_id, chave_nfe) WHERE chave_nfe IS NOT NULL AND status = 'confirmed';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nfe_imports TO authenticated;
GRANT ALL ON public.nfe_imports TO service_role;

ALTER TABLE public.nfe_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read nfe_imports"
ON public.nfe_imports FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.tenant_id = nfe_imports.tenant_id
  )
);

CREATE POLICY "tenant members insert nfe_imports"
ON public.nfe_imports FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.tenant_id = nfe_imports.tenant_id
  )
);

CREATE POLICY "tenant members update nfe_imports"
ON public.nfe_imports FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.tenant_id = nfe_imports.tenant_id
  )
);

CREATE POLICY "tenant members delete nfe_imports"
ON public.nfe_imports FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.tenant_id = nfe_imports.tenant_id
  )
);

CREATE TRIGGER trg_nfe_imports_updated
BEFORE UPDATE ON public.nfe_imports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();