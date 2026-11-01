-- Diferencia preço aprovado, preço indicativo e mercado seminovo encontrado.
ALTER TABLE public.market_pricer_items
  ADD COLUMN IF NOT EXISTS semi_new_count INTEGER NOT NULL DEFAULT 0 CHECK (semi_new_count >= 0),
  ADD COLUMN IF NOT EXISTS market_condition TEXT NOT NULL DEFAULT 'none'
    CHECK (market_condition IN ('new', 'semi_new', 'indicative', 'none'));
