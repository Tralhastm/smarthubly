-- Permite distinguir uma análise com fontes indicativas de uma análise sem evidência.
ALTER TABLE public.market_pricer_items
  DROP CONSTRAINT IF EXISTS market_pricer_items_evidence_status_check;
ALTER TABLE public.market_pricer_items
  ADD CONSTRAINT market_pricer_items_evidence_status_check
  CHECK (evidence_status IN ('suficiente', 'indicativo', 'inconclusivo'));
