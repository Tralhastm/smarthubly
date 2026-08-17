
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS pix_key text DEFAULT '',
  ADD COLUMN IF NOT EXISTS pix_key_type text DEFAULT '';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS change_for numeric DEFAULT 0;
