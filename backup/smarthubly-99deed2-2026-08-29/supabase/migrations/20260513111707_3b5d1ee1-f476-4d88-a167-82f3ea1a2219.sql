ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS external_tracking_url text,
  ADD COLUMN IF NOT EXISTS external_tracking_provider text;