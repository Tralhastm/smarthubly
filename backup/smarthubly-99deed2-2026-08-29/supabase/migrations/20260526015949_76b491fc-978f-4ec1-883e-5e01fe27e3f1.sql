
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS kitchen_sector TEXT
  CHECK (kitchen_sector IN ('cozinha','bar','pizza','sobremesa','outro'));

CREATE INDEX IF NOT EXISTS idx_products_kitchen_sector ON public.products(tenant_id, kitchen_sector);
