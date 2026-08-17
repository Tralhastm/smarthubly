-- 1) Campos PagBank em tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS pagbank_token text,
  ADD COLUMN IF NOT EXISTS pagbank_env text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'mercadopago';

-- Validação leve do provider e env
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_payment_provider_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_payment_provider_check
  CHECK (payment_provider IN ('mercadopago','pagbank'));

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_pagbank_env_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_pagbank_env_check
  CHECK (pagbank_env IN ('sandbox','production'));

-- 2) Tabela de transações de pagamento (genérica, multi-provedor)
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  provider text NOT NULL,                  -- 'mercadopago' | 'pagbank'
  method text,                              -- 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'checkout_link'
  status text NOT NULL DEFAULT 'pending',   -- 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'
  amount numeric NOT NULL DEFAULT 0,
  external_id text,                         -- id do pedido/charge no provedor
  external_reference text,                  -- nosso ref enviado pro provedor
  checkout_url text,                        -- link de pagamento (quando aplicável)
  pix_qr_code text,                         -- QR text (copia-e-cola)
  pix_qr_image text,                        -- base64 ou url da imagem
  raw_request jsonb,
  raw_response jsonb,
  raw_webhook jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_tenant ON public.payment_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_order ON public.payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_external ON public.payment_transactions(provider, external_id);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Leitura: admins da loja podem ver as transações da sua loja
DROP POLICY IF EXISTS "tenant admins read payment_transactions" ON public.payment_transactions;
CREATE POLICY "tenant admins read payment_transactions"
  ON public.payment_transactions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin', tenant_id));

-- Escrita só via service role (edge functions). Nenhuma policy de INSERT/UPDATE/DELETE pra clientes.

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_payment_tx_updated_at ON public.payment_transactions;
CREATE TRIGGER trg_payment_tx_updated_at
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();