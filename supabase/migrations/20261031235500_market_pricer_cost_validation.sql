-- Separates the deterministic minimum viable price from a market-approved recommendation.
ALTER TABLE public.market_pricer_items
  ADD COLUMN IF NOT EXISTS minimum_price NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS recommended_market_price NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS cost_warning TEXT NULL;

COMMENT ON COLUMN public.market_pricer_items.minimum_price IS 'Preço mínimo viável: custos + despesas + lucro mínimo.';
COMMENT ON COLUMN public.market_pricer_items.recommended_market_price IS 'Preço recomendado somente quando há evidência comparável suficiente e o mercado cobre o mínimo viável.';
COMMENT ON COLUMN public.market_pricer_items.cost_warning IS 'Alerta de validação do custo de entrada.';
