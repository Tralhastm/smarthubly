
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_received boolean NOT NULL DEFAULT false;

-- Backfill: pedidos já entregues OU pagos via mercadopago contam como recebidos
UPDATE public.orders
SET payment_received = true
WHERE payment_received = false
  AND (
    status = 'delivered'
    OR LOWER(COALESCE(payment_method,'')) IN ('mercadopago')
  )
  AND LOWER(COALESCE(payment_method,'')) <> 'fiado';
