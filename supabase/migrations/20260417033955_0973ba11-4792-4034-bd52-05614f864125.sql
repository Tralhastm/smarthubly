ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS brand_primary_color text NOT NULL DEFAULT '#3B82F6',
  ADD COLUMN IF NOT EXISTS brand_bg_color text NOT NULL DEFAULT '#0F172A';