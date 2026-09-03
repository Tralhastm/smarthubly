
-- Add dropshipping support to tenants
ALTER TABLE public.tenants ADD COLUMN is_dropshipping boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenants ADD COLUMN platform_fee_percent numeric NOT NULL DEFAULT 5;

-- Add original/cost price to products
ALTER TABLE public.products ADD COLUMN original_price numeric NOT NULL DEFAULT 0;
