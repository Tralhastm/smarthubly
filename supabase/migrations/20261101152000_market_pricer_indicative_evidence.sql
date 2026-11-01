-- Evidências indicativas: úteis para auditoria, mas não aprovam preço de mercado.
ALTER TABLE public.market_pricer_items
  ADD COLUMN IF NOT EXISTS evidence_indicative_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_indicative_count >= 0);

ALTER TABLE public.market_pricer_sources
  DROP CONSTRAINT IF EXISTS market_pricer_sources_status_check;
ALTER TABLE public.market_pricer_sources
  ADD CONSTRAINT market_pricer_sources_status_check
  CHECK (status IN ('comparable', 'indicative', 'rejected'));
