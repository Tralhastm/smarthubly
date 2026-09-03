ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS asaas_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asaas_environment text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS asaas_sandbox_token text,
  ADD COLUMN IF NOT EXISTS asaas_production_token text,
  ADD COLUMN IF NOT EXISTS asaas_webhook_token text;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_asaas_environment_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_asaas_environment_check
  CHECK (asaas_environment IN ('sandbox', 'production'));
