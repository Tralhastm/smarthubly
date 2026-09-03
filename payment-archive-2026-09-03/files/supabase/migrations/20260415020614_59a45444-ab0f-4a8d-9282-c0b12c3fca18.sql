
-- Add donated flag to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_donated boolean NOT NULL DEFAULT false;

-- Add shipping configuration to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS shipping_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS shipping_base_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS shipping_base_radius_km numeric NOT NULL DEFAULT 5;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS shipping_per_km_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS shipping_origin_address text NOT NULL DEFAULT '';

-- Add per-product shipping flag
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS has_shipping boolean NOT NULL DEFAULT false;
