ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS scheduling_auto_confirm boolean NOT NULL DEFAULT true;