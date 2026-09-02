-- InfinitePay opcional por loja; Mercado Pago e PagBank permanecem válidos.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS infinitepay_handle text,
  ADD COLUMN IF NOT EXISTS infinitepay_document text,
  ADD COLUMN IF NOT EXISTS infinitepay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS infinitepay_installment_fees jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_payment_provider_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_payment_provider_check
  CHECK (payment_provider IN ('mercadopago','pagbank','infinitepay'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_flow text,
  ADD COLUMN IF NOT EXISTS installments integer,
  ADD COLUMN IF NOT EXISTS fee_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_fixed_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_total numeric,
  ADD COLUMN IF NOT EXISTS charge_total numeric,
  ADD COLUMN IF NOT EXISTS payment_external_id text,
  ADD COLUMN IF NOT EXISTS payment_nsu text,
  ADD COLUMN IF NOT EXISTS payment_authorization_code text,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS return_notes text;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_flow_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_flow_check
  CHECK (payment_flow IS NULL OR payment_flow IN ('online','delivery_tap'));

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS installments integer,
  ADD COLUMN IF NOT EXISTS authorization_code text,
  ADD COLUMN IF NOT EXISTS nsu text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_nsu_unique
  ON public.payment_transactions(provider, nsu) WHERE nsu IS NOT NULL;
