ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS store_visible BOOLEAN NOT NULL DEFAULT true;

UPDATE public.products
SET store_visible = true
WHERE store_visible IS NULL;

COMMENT ON COLUMN public.products.store_visible IS
  'Controls storefront visibility independently from inventory availability.';
