ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS allow_loss boolean NOT NULL DEFAULT false;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS allow_loss boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.allow_loss IS 'Permite vender o produto mesmo quando o cálculo de lucro final for negativo.';
COMMENT ON COLUMN public.product_variants.allow_loss IS 'Permite vender a variação mesmo quando o cálculo de lucro final for negativo.';
***
