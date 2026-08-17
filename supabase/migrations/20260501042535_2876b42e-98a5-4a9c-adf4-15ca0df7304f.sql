ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS scheduling_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quotes_feature_enabled boolean NOT NULL DEFAULT false;