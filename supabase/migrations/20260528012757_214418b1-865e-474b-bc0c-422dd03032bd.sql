
-- ===== webhook_events: idempotência de webhooks =====
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  tenant_id UUID,
  order_id UUID,
  payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_provider_event_id_unique UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant ON public.webhook_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_order ON public.webhook_events(order_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON public.webhook_events(processed_at DESC);

GRANT ALL ON public.webhook_events TO service_role;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages webhook_events"
  ON public.webhook_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ===== fiscal_invoices: idempotency_key =====
ALTER TABLE public.fiscal_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_invoices_idempotency
  ON public.fiscal_invoices(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ===== orders: controle de impressão =====
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS printed_by TEXT,
  ADD COLUMN IF NOT EXISTS print_count INTEGER NOT NULL DEFAULT 0;

-- ===== helper: registrar webhook de forma idempotente =====
CREATE OR REPLACE FUNCTION public.register_webhook_event(
  _provider TEXT,
  _event_id TEXT,
  _event_type TEXT DEFAULT NULL,
  _tenant_id UUID DEFAULT NULL,
  _order_id UUID DEFAULT NULL,
  _payload JSONB DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.webhook_events (provider, event_id, event_type, tenant_id, order_id, payload)
  VALUES (_provider, _event_id, _event_type, _tenant_id, _order_id, _payload);
  RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
  RETURN FALSE;
END;
$$;
