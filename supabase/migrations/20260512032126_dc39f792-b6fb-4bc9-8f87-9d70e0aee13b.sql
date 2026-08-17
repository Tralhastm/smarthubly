
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS uber_direct_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS uber_direct_customer_id text,
  ADD COLUMN IF NOT EXISTS uber_direct_client_id text,
  ADD COLUMN IF NOT EXISTS uber_direct_client_secret text,
  ADD COLUMN IF NOT EXISTS uber_direct_sandbox boolean DEFAULT true;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS uber_direct_delivery_id text,
  ADD COLUMN IF NOT EXISTS uber_direct_status text,
  ADD COLUMN IF NOT EXISTS uber_direct_tracking_url text,
  ADD COLUMN IF NOT EXISTS uber_direct_price numeric,
  ADD COLUMN IF NOT EXISTS delivery_provider text;
