ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS lalamove_api_key TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS lalamove_api_secret TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS lalamove_market TEXT DEFAULT 'BR_SAO',
  ADD COLUMN IF NOT EXISTS lalamove_sandbox BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lalamove_use_store_api TEXT NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.suppliers.lalamove_use_store_api IS 'Status do uso da API Lalamove da loja: none, pending, approved, revoked';