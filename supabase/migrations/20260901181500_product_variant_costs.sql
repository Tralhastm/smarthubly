ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC,
  ADD COLUMN IF NOT EXISTS suggested_price NUMERIC,
  ADD COLUMN IF NOT EXISTS needs_price_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_source TEXT;

COMMENT ON COLUMN public.product_variants.cost_price IS 'Custo informado pelo fornecedor para esta variação.';
COMMENT ON COLUMN public.product_variants.suggested_price IS 'Preço de venda sugerido com base no custo e margem configurada.';
COMMENT ON COLUMN public.product_variants.needs_price_review IS 'Indica que o administrador deve revisar o preço desta variação.';
COMMENT ON COLUMN public.product_variants.price_source IS 'Origem do custo, por exemplo catálogo do fornecedor.';
