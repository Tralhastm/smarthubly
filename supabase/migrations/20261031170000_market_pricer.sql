-- Precificador de Mercado: entradas, gastos configuráveis, evidências e histórico.
-- Os cálculos financeiros são feitos no cliente por regras determinísticas e os
-- snapshots permitem auditar exatamente a configuração usada em cada análise.

CREATE TABLE IF NOT EXISTS public.market_pricer_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  amount_type TEXT NOT NULL CHECK (amount_type IN ('percentage', 'fixed')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  product_id TEXT NULL REFERENCES public.products(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_pricer_expenses_tenant
  ON public.market_pricer_expenses (tenant_id, enabled, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_pricer_expenses_product
  ON public.market_pricer_expenses (product_id) WHERE product_id IS NOT NULL;
ALTER TABLE public.market_pricer_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Market pricer admins read own expenses" ON public.market_pricer_expenses;
CREATE POLICY "Market pricer admins read own expenses"
  ON public.market_pricer_expenses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Market pricer admins insert own expenses" ON public.market_pricer_expenses;
CREATE POLICY "Market pricer admins insert own expenses"
  ON public.market_pricer_expenses FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Market pricer admins update own expenses" ON public.market_pricer_expenses;
CREATE POLICY "Market pricer admins update own expenses"
  ON public.market_pricer_expenses FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Market pricer admins delete own expenses" ON public.market_pricer_expenses;
CREATE POLICY "Market pricer admins delete own expenses"
  ON public.market_pricer_expenses FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TABLE IF NOT EXISTS public.market_pricer_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  input_name TEXT NULL,
  source_text TEXT NOT NULL DEFAULT '',
  selected_limit INTEGER NOT NULL DEFAULT 40 CHECK (selected_limit BETWEEN 1 AND 40),
  minimum_profit NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (minimum_profit >= 0),
  expenses_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'researching', 'completed', 'partial', 'failed')),
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_pricer_analyses_tenant
  ON public.market_pricer_analyses (tenant_id, created_at DESC);
ALTER TABLE public.market_pricer_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Market pricer admins read own analyses" ON public.market_pricer_analyses;
CREATE POLICY "Market pricer admins read own analyses"
  ON public.market_pricer_analyses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Market pricer admins insert own analyses" ON public.market_pricer_analyses;
CREATE POLICY "Market pricer admins insert own analyses"
  ON public.market_pricer_analyses FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Market pricer admins update own analyses" ON public.market_pricer_analyses;
CREATE POLICY "Market pricer admins update own analyses"
  ON public.market_pricer_analyses FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TABLE IF NOT EXISTS public.market_pricer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.market_pricer_analyses(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  supplier_cost NUMERIC(12,2) NULL CHECK (supplier_cost IS NULL OR supplier_cost >= 0),
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  market_min NUMERIC(12,2) NULL,
  market_median NUMERIC(12,2) NULL,
  market_max NUMERIC(12,2) NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  demand_note TEXT NOT NULL DEFAULT 'Demanda estimada; não há volume público confirmado.',
  suggested_price NUMERIC(12,2) NULL,
  fixed_expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  percentage_expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_profit NUMERIC(12,2) NULL,
  margin_percent NUMERIC(12,2) NULL,
  decision TEXT NOT NULL DEFAULT 'inconclusivo' CHECK (decision IN ('carro-chefe', 'margem-segura', 'inconclusivo')),
  evidence_status TEXT NOT NULL DEFAULT 'inconclusivo' CHECK (evidence_status IN ('suficiente', 'inconclusivo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_pricer_items_analysis
  ON public.market_pricer_items (analysis_id, occurrences DESC);
ALTER TABLE public.market_pricer_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Market pricer admins read own items" ON public.market_pricer_items;
CREATE POLICY "Market pricer admins read own items"
  ON public.market_pricer_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Market pricer admins insert own items" ON public.market_pricer_items;
CREATE POLICY "Market pricer admins insert own items"
  ON public.market_pricer_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TABLE IF NOT EXISTS public.market_pricer_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_item_id UUID NOT NULL REFERENCES public.market_pricer_items(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price > 0),
  url TEXT NOT NULL,
  condition TEXT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_pricer_sources_item
  ON public.market_pricer_sources (analysis_item_id, price);
ALTER TABLE public.market_pricer_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Market pricer admins read own sources" ON public.market_pricer_sources;
CREATE POLICY "Market pricer admins read own sources"
  ON public.market_pricer_sources FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Market pricer admins insert own sources" ON public.market_pricer_sources;
CREATE POLICY "Market pricer admins insert own sources"
  ON public.market_pricer_sources FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE OR REPLACE FUNCTION public.market_pricer_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_market_pricer_expenses_updated_at ON public.market_pricer_expenses;
CREATE TRIGGER trg_market_pricer_expenses_updated_at
  BEFORE UPDATE ON public.market_pricer_expenses
  FOR EACH ROW EXECUTE FUNCTION public.market_pricer_touch_updated_at();
