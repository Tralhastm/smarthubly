ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS shipping_lalamove_apply_cap boolean NOT NULL DEFAULT false;