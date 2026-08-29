ALTER TABLE public.tenants
  ADD COLUMN fee_mode text NOT NULL DEFAULT 'margin',
  ADD COLUMN fee_split_store_percent numeric NOT NULL DEFAULT 50;