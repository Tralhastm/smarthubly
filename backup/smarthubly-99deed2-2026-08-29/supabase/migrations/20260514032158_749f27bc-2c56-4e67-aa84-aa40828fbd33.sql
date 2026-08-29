ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS dropshipping_submode text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS whatsapp_consultora_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_default_address_source text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS whatsapp_store_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_store_cep text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dropshipping_freight_mode text NOT NULL DEFAULT 'viacep_estimate';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS whatsapp_address_source text,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_orders_whatsapp_batch ON public.orders(whatsapp_batch_id) WHERE whatsapp_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_whatsapp_pending ON public.orders(tenant_id, whatsapp_sent_at) WHERE whatsapp_sent_at IS NULL;