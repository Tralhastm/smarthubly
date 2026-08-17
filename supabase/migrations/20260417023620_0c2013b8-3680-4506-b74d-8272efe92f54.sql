ALTER TABLE public.tenants 
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'per_order',
  ADD COLUMN IF NOT EXISTS monthly_fee numeric NOT NULL DEFAULT 60;

ALTER TABLE public.tenants 
  ADD CONSTRAINT tenants_billing_mode_check 
  CHECK (billing_mode IN ('per_order', 'monthly_fixed'));