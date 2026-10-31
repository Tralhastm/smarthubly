-- Índices incrementais das chaves estrangeiras do Precificador.
CREATE INDEX IF NOT EXISTS idx_market_pricer_expenses_created_by
  ON public.market_pricer_expenses (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_pricer_analyses_created_by
  ON public.market_pricer_analyses (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_pricer_items_tenant
  ON public.market_pricer_items (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_pricer_sources_tenant
  ON public.market_pricer_sources (tenant_id, collected_at DESC);
