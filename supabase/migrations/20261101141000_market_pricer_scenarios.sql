-- Guarda os dois cenários financeiros exibidos pelo Precificador:
-- preço mínimo viável e preço de mercado aprovado.
ALTER TABLE public.market_pricer_items
  ADD COLUMN IF NOT EXISTS market_net_profit NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS market_margin_percent NUMERIC(12,2) NULL;
