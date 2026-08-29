ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS shipping_lalamove_auto boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS shipping_lalamove_margin_percent numeric NOT NULL DEFAULT 0;