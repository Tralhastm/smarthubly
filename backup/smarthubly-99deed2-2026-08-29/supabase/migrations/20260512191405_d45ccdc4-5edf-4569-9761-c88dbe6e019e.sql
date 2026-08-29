-- Adiciona código curto compartilhável e ID do device dono da comanda
ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS share_code text,
  ADD COLUMN IF NOT EXISTS owner_device_id text;

CREATE INDEX IF NOT EXISTS idx_table_sessions_share_code ON public.table_sessions(tenant_id, share_code) WHERE share_code IS NOT NULL;