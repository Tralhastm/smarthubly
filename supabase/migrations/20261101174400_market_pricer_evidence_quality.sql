-- Qualidade auditável das evidências do Precificador.
-- A migração é aditiva: preserva análises e fontes já salvas.
ALTER TABLE public.market_pricer_analyses
  DROP CONSTRAINT IF EXISTS market_pricer_analyses_selected_limit_check;
ALTER TABLE public.market_pricer_analyses
  ADD CONSTRAINT market_pricer_analyses_selected_limit_check
  CHECK (selected_limit BETWEEN 1 AND 53);

ALTER TABLE public.market_pricer_items
  ADD COLUMN IF NOT EXISTS evidence_found_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_found_count >= 0),
  ADD COLUMN IF NOT EXISTS evidence_rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_rejected_count >= 0),
  ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'insufficient_evidence'
    CHECK (quality_status IN ('approved', 'insufficient_evidence', 'suspect')),
  ADD COLUMN IF NOT EXISTS quality_note TEXT NOT NULL DEFAULT 'Análise histórica sem classificação detalhada de qualidade.';

ALTER TABLE public.market_pricer_sources
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'comparable'
    CHECK (status IN ('comparable', 'rejected')),
  ADD COLUMN IF NOT EXISTS acceptance_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;
