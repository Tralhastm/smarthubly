ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_source text;

COMMENT ON COLUMN public.products.image_source IS
  'Origin marker for the product cover image, e.g. ai-curation; NULL means unmarked/manual.';
