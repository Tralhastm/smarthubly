-- Adiciona campos pra categorização automática por IA
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS subcategory text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_categorize boolean NOT NULL DEFAULT true;

ALTER TABLE public.quote_variables
  ADD COLUMN IF NOT EXISTS subcategory text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_categorize boolean NOT NULL DEFAULT true;