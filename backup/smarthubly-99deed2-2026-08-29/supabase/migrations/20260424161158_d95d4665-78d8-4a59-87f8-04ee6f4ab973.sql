-- Toggles em tenants para Onda 3
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS auto_reconcile_mp BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_backup_catalog BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_fraud_check BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS fraud_strictness TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS auto_review_ai_reply BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_detect_ghost_orders BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_affiliate_match BOOLEAN NOT NULL DEFAULT FALSE;

-- 1) MP reconciliation
CREATE TABLE IF NOT EXISTS public.mp_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  payments_checked INT NOT NULL DEFAULT 0,
  matched INT NOT NULL DEFAULT 0,
  divergent INT NOT NULL DEFAULT 0,
  divergences JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT
);
ALTER TABLE public.mp_reconciliation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read mp recon" ON public.mp_reconciliation_runs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "System inserts mp recon" ON public.mp_reconciliation_runs FOR INSERT TO authenticated WITH CHECK (true);

-- 2) Catalog backups
CREATE TABLE IF NOT EXISTS public.catalog_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  product_count INT NOT NULL DEFAULT 0,
  variant_count INT NOT NULL DEFAULT 0,
  addon_count INT NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL,
  size_bytes INT NOT NULL DEFAULT 0
);
ALTER TABLE public.catalog_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read backups" ON public.catalog_backups FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins restore (delete) backups" ON public.catalog_backups FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "System inserts backups" ON public.catalog_backups FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_catalog_backups_tenant_created ON public.catalog_backups (tenant_id, created_at DESC);

-- 3) Fraud blocks
CREATE TABLE IF NOT EXISTS public.fraud_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID,
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  risk_score INT NOT NULL DEFAULT 0,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  action TEXT NOT NULL DEFAULT 'flagged',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fraud_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read fraud blocks" ON public.fraud_blocks FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins update fraud blocks" ON public.fraud_blocks FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "System inserts fraud blocks" ON public.fraud_blocks FOR INSERT TO authenticated, anon WITH CHECK (true);

-- 4) Ghost order flags
CREATE TABLE IF NOT EXISTS public.ghost_order_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  ghost_score INT NOT NULL DEFAULT 0,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
ALTER TABLE public.ghost_order_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read ghost flags" ON public.ghost_order_flags FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins update ghost flags" ON public.ghost_order_flags FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "System inserts ghost flags" ON public.ghost_order_flags FOR INSERT TO authenticated WITH CHECK (true);

-- 5) Affiliate match suggestions
CREATE TABLE IF NOT EXISTS public.affiliate_match_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  product_description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  suggested_network TEXT,
  suggested_url TEXT,
  rationale TEXT,
  match_score INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acted_at TIMESTAMPTZ
);
ALTER TABLE public.affiliate_match_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read affiliate matches" ON public.affiliate_match_suggestions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Admins update affiliate matches" ON public.affiliate_match_suggestions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "System inserts affiliate matches" ON public.affiliate_match_suggestions FOR INSERT TO authenticated WITH CHECK (true);

-- Função SQL: detectar pedidos fantasma (delivered há > 48h sem review e sem confirm)
CREATE OR REPLACE FUNCTION public.detect_ghost_orders()
RETURNS TABLE(flagged_id UUID, flagged_tenant UUID, flagged_order UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id, o.tenant_id, o.customer_phone
      FROM public.orders o
      JOIN public.tenants t ON t.id = o.tenant_id
     WHERE t.auto_detect_ghost_orders = TRUE
       AND o.status = 'out-for-delivery'
       AND o.updated_at < now() - INTERVAL '90 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.ghost_order_flags g WHERE g.order_id = o.id)
     LIMIT 100
  ), ins AS (
    INSERT INTO public.ghost_order_flags (tenant_id, order_id, customer_phone, reason, ghost_score)
    SELECT tenant_id, id, customer_phone, 'out_for_delivery_no_confirm_90min', 70 FROM candidates
    RETURNING id, tenant_id, order_id
  )
  SELECT id, tenant_id, order_id FROM ins;
END;
$$;