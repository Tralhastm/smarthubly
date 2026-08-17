
-- ============ Conciliação de adquirente ============
CREATE TABLE IF NOT EXISTS public.acquirer_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  acquirer TEXT NOT NULL, -- stone, cielo, rede, getnet, outro
  transaction_date TIMESTAMPTZ NOT NULL,
  authorization_code TEXT,
  nsu TEXT,
  card_brand TEXT, -- visa, master, elo, amex...
  installments INTEGER DEFAULT 1,
  gross_amount NUMERIC(12,2) NOT NULL,
  fee_amount NUMERIC(12,2) DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL,
  expected_settlement_date DATE,
  actual_settlement_date DATE,
  matched_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, matched, divergent, settled
  divergence_reason TEXT,
  raw_data JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acq_rec_tenant ON public.acquirer_reconciliations(tenant_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_acq_rec_status ON public.acquirer_reconciliations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_acq_rec_order ON public.acquirer_reconciliations(matched_order_id);

ALTER TABLE public.acquirer_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acq_rec_admin_select" ON public.acquirer_reconciliations FOR SELECT
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "acq_rec_admin_insert" ON public.acquirer_reconciliations FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "acq_rec_admin_update" ON public.acquirer_reconciliations FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "acq_rec_admin_delete" ON public.acquirer_reconciliations FOR DELETE
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_acq_rec_updated_at BEFORE UPDATE ON public.acquirer_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Contas a pagar e a receber ============
CREATE TABLE IF NOT EXISTS public.accounts_payable_receivable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'payable' | 'receivable'
  description TEXT NOT NULL,
  category TEXT,
  amount NUMERIC(12,2) NOT NULL,
  due_date DATE NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  supplier_or_payer TEXT,
  recurrence TEXT, -- null, 'monthly', 'weekly', 'yearly'
  recurrence_until DATE,
  alert_days_before INTEGER DEFAULT 3,
  notes TEXT,
  attachments JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apr_tenant_due ON public.accounts_payable_receivable(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_apr_tenant_kind ON public.accounts_payable_receivable(tenant_id, kind, paid);

ALTER TABLE public.accounts_payable_receivable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "apr_admin_select" ON public.accounts_payable_receivable FOR SELECT
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "apr_admin_insert" ON public.accounts_payable_receivable FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "apr_admin_update" ON public.accounts_payable_receivable FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "apr_admin_delete" ON public.accounts_payable_receivable FOR DELETE
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_apr_updated_at BEFORE UPDATE ON public.accounts_payable_receivable
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Fluxo de caixa projetado (30d) ============
CREATE OR REPLACE FUNCTION public.get_cash_flow_projection(_tenant_id UUID, _days INTEGER DEFAULT 30)
RETURNS TABLE(d DATE, projected_in NUMERIC, projected_out NUMERIC, net NUMERIC, accumulated NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acc NUMERIC := 0;
BEGIN
  FOR d, projected_in, projected_out IN
    SELECT
      gs.dia::date,
      COALESCE((SELECT SUM(amount) FROM accounts_payable_receivable
                 WHERE tenant_id = _tenant_id AND kind = 'receivable' AND paid = false AND due_date = gs.dia::date), 0)
      + COALESCE((SELECT SUM(net_amount) FROM acquirer_reconciliations
                   WHERE tenant_id = _tenant_id AND status IN ('matched','pending')
                     AND expected_settlement_date = gs.dia::date), 0),
      COALESCE((SELECT SUM(amount) FROM accounts_payable_receivable
                 WHERE tenant_id = _tenant_id AND kind = 'payable' AND paid = false AND due_date = gs.dia::date), 0)
    FROM generate_series(current_date, current_date + (_days || ' days')::interval, '1 day') gs(dia)
    ORDER BY gs.dia
  LOOP
    net := projected_in - projected_out;
    v_acc := v_acc + net;
    accumulated := v_acc;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ============ DRE comparativo (mês a mês) ============
CREATE OR REPLACE FUNCTION public.get_dre_comparison(_tenant_id UUID, _months INTEGER DEFAULT 6)
RETURNS TABLE(month_start DATE, revenue NUMERIC, cmv NUMERIC, platform_fee NUMERIC, expenses NUMERIC, net_profit NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from TIMESTAMPTZ;
  v_to TIMESTAMPTZ;
  v_dre JSONB;
BEGIN
  FOR month_start IN
    SELECT (date_trunc('month', current_date) - (i || ' months')::interval)::date
      FROM generate_series(_months - 1, 0, -1) i
  LOOP
    v_from := month_start::timestamptz;
    v_to := (month_start + interval '1 month' - interval '1 second')::timestamptz;
    v_dre := public.get_dre(_tenant_id, v_from, v_to);
    revenue := (v_dre->>'revenue')::numeric;
    cmv := (v_dre->>'cmv')::numeric;
    platform_fee := (v_dre->>'platform_fee')::numeric;
    expenses := (v_dre->>'expenses')::numeric;
    net_profit := (v_dre->>'net_profit')::numeric;
    RETURN NEXT;
  END LOOP;
END;
$$;
