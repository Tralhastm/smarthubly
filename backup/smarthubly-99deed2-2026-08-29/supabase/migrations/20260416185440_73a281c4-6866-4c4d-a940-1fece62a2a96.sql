-- Add automation toggles to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS auto_dropshipping_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dropshipping_review_mode boolean NOT NULL DEFAULT false;

-- Order events: full audit trail
CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  event_type text NOT NULL, -- 'status_change' | 'auto_assign_supplier' | 'auto_advance' | 'note'
  from_status text,
  to_status text,
  actor text NOT NULL DEFAULT 'system', -- 'system' | 'customer' | 'admin' | 'supplier' | 'driver'
  actor_id text,
  description text NOT NULL DEFAULT '',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON public.order_events(order_id);
CREATE INDEX IF NOT EXISTS order_events_tenant_id_idx ON public.order_events(tenant_id);

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert order events"
  ON public.order_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can view order events"
  ON public.order_events FOR SELECT
  TO anon, authenticated
  USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_events;