ALTER TABLE public.tenants 
  ADD COLUMN IF NOT EXISTS pickup_enabled boolean NOT NULL DEFAULT true;