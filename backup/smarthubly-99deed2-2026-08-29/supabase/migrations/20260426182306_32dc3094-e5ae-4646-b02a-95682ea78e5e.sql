-- 1) Adiciona payment_method em financial_entries (Pix/Dinheiro/Crédito/Débito/Outro)
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'outro';

CREATE INDEX IF NOT EXISTS idx_financial_entries_payment_method
  ON public.financial_entries(tenant_id, payment_method);

-- 2) Adiciona conceito de "previsto" (lançamento futuro/agendado)
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS is_forecast BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forecast_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_financial_entries_forecast
  ON public.financial_entries(tenant_id, is_forecast, forecast_date);

-- 3) Tabela de investimentos (Fixo trancado vs Liquidez diária)
CREATE TABLE IF NOT EXISTS public.investments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fixed', -- 'fixed' (trancado) ou 'liquid' (em conta/diário)
  amount NUMERIC NOT NULL DEFAULT 0,
  yield_rate NUMERIC NOT NULL DEFAULT 0, -- taxa anual estimada (%)
  notes TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  matures_at TIMESTAMP WITH TIME ZONE,
  liquidated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view investments"
  ON public.investments FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins insert investments"
  ON public.investments FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins update investments"
  ON public.investments FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins delete investments"
  ON public.investments FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_investments_updated_at
  BEFORE UPDATE ON public.investments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_investments_tenant ON public.investments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_investments_kind ON public.investments(tenant_id, kind, liquidated_at);