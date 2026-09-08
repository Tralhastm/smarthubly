ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'new';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_condition_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_condition_check
  CHECK (condition IN ('new', 'grade_a'));

CREATE INDEX IF NOT EXISTS products_tenant_condition_idx
  ON public.products (tenant_id, condition);
