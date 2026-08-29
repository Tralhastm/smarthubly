
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS printer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS printer_mode text NOT NULL DEFAULT 'manual', -- 'auto' | 'manual' | 'both'
  ADD COLUMN IF NOT EXISTS printer_paper_width text NOT NULL DEFAULT '80mm', -- '58mm' | '80mm'
  ADD COLUMN IF NOT EXISTS printer_kitchen_copy boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS printer_header_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS printer_footer_text text NOT NULL DEFAULT 'Obrigado pela preferência!',
  ADD COLUMN IF NOT EXISTS printer_agent_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  ADD COLUMN IF NOT EXISTS sound_alert_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sound_alert_loud boolean NOT NULL DEFAULT true;

-- Marca de pedidos já impressos (pra não reimprimir automático no refresh)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS print_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_tenant_printed ON public.orders(tenant_id, printed_at);
