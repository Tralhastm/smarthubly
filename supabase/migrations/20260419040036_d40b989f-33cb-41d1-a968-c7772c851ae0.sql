ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS shipping_base_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_base_radius_km numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS shipping_per_km_fee numeric NOT NULL DEFAULT 0;