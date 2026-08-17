ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS delivery_responsible text NOT NULL DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS shipping_mode text NOT NULL DEFAULT 'own';

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS shipping_mode text NOT NULL DEFAULT 'own';