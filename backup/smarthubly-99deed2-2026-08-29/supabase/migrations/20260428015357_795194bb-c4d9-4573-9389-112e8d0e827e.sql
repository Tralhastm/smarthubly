ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS is_credit_card boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;

-- Backfill: tudo que já existe continua "pago" (não estava no cartão pendente)
UPDATE public.financial_entries
   SET paid = true,
       paid_at = COALESCE(paid_at, date)
 WHERE paid IS DISTINCT FROM true;

CREATE INDEX IF NOT EXISTS idx_financial_entries_tenant_paid
  ON public.financial_entries (tenant_id, paid, is_credit_card);