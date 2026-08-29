CREATE TABLE IF NOT EXISTS public.image_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_ids uuid[] NOT NULL DEFAULT '{}',
  total int NOT NULL DEFAULT 0,
  done int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  reason text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  cooldown_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_image_jobs_tenant_started
  ON public.image_generation_jobs (tenant_id, started_at DESC);

ALTER TABLE public.image_generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read image jobs" ON public.image_generation_jobs;
CREATE POLICY "Admins read image jobs" ON public.image_generation_jobs
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

DROP POLICY IF EXISTS "Admins insert image jobs" ON public.image_generation_jobs;
CREATE POLICY "Admins insert image jobs" ON public.image_generation_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

DROP POLICY IF EXISTS "Admins update image jobs" ON public.image_generation_jobs;
CREATE POLICY "Admins update image jobs" ON public.image_generation_jobs
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

CREATE TRIGGER trg_image_jobs_updated_at
  BEFORE UPDATE ON public.image_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();