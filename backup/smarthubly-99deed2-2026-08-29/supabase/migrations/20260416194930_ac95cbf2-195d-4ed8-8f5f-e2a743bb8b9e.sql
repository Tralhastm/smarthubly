-- Allow push_subscriptions to belong to either a driver or a supplier
ALTER TABLE public.push_subscriptions
  ALTER COLUMN driver_id DROP NOT NULL;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE;

-- Ensure at least one of driver_id or supplier_id is set
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_owner_check;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_owner_check
  CHECK (driver_id IS NOT NULL OR supplier_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_supplier_id
  ON public.push_subscriptions(supplier_id) WHERE supplier_id IS NOT NULL;