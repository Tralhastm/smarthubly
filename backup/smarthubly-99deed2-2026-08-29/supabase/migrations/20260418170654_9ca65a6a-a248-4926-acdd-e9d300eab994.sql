ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS lalamove_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lalamove_api_key text DEFAULT '',
  ADD COLUMN IF NOT EXISTS lalamove_api_secret text DEFAULT '',
  ADD COLUMN IF NOT EXISTS lalamove_market text DEFAULT 'BR_SAO',
  ADD COLUMN IF NOT EXISTS lalamove_sandbox boolean NOT NULL DEFAULT true;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS lalamove_order_id text,
  ADD COLUMN IF NOT EXISTS lalamove_status text,
  ADD COLUMN IF NOT EXISTS lalamove_share_link text,
  ADD COLUMN IF NOT EXISTS lalamove_driver_name text,
  ADD COLUMN IF NOT EXISTS lalamove_driver_phone text,
  ADD COLUMN IF NOT EXISTS lalamove_driver_plate text,
  ADD COLUMN IF NOT EXISTS lalamove_price numeric;