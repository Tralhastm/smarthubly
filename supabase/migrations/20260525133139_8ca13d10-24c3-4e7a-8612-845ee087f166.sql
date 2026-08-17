-- =========================================
-- CAIXA (cash register)
-- =========================================
CREATE TABLE IF NOT EXISTS public.cash_register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  operator_name TEXT NOT NULL,
  operator_role TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  closing_amount NUMERIC(12,2),
  expected_amount NUMERIC(12,2),
  difference NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  notes TEXT,
  closed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_open ON public.cash_register_sessions(tenant_id, status);

ALTER TABLE public.cash_register_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage own tenant cash sessions" ON public.cash_register_sessions
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin', tenant_id))
WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id));

-- Permite o PDV (anon) inserir/ler/atualizar sessões da própria loja
-- (validação por PIN é feita no app; mantém o mesmo padrão das mesas).
CREATE POLICY "Public can read cash sessions" ON public.cash_register_sessions
FOR SELECT USING (true);

CREATE POLICY "Public can create cash sessions" ON public.cash_register_sessions
FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can update cash sessions" ON public.cash_register_sessions
FOR UPDATE USING (true);

CREATE TRIGGER trg_cash_sessions_updated_at
BEFORE UPDATE ON public.cash_register_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- MOVIMENTAÇÕES (sangria/suprimento/ajuste)
-- =========================================
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.cash_register_sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sangria','suprimento','ajuste')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT,
  operator_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON public.cash_movements(session_id);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage own tenant cash movements" ON public.cash_movements
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin', tenant_id))
WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id));

CREATE POLICY "Public can read cash movements" ON public.cash_movements
FOR SELECT USING (true);

CREATE POLICY "Public can create cash movements" ON public.cash_movements
FOR INSERT WITH CHECK (true);

-- =========================================
-- ORDERS: caixa + KDS + split
-- =========================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cash_session_id UUID REFERENCES public.cash_register_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS split_payments JSONB,
  ADD COLUMN IF NOT EXISTS kds_status TEXT DEFAULT 'queue' CHECK (kds_status IN ('queue','preparing','ready','done')),
  ADD COLUMN IF NOT EXISTS kds_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kds_ready_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_cash_session ON public.orders(cash_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_kds ON public.orders(tenant_id, kds_status) WHERE kds_status <> 'done';

-- =========================================
-- HELPER: calcula esperado de uma sessão
-- =========================================
CREATE OR REPLACE FUNCTION public.calc_cash_session_expected(_session_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_opening NUMERIC := 0;
  v_cash_sales NUMERIC := 0;
  v_suprimento NUMERIC := 0;
  v_sangria NUMERIC := 0;
BEGIN
  SELECT opening_amount INTO v_opening FROM public.cash_register_sessions WHERE id = _session_id;

  SELECT COALESCE(SUM(total),0) INTO v_cash_sales
    FROM public.orders
   WHERE cash_session_id = _session_id
     AND LOWER(COALESCE(payment_method,'')) = 'dinheiro';

  SELECT COALESCE(SUM(amount),0) INTO v_suprimento
    FROM public.cash_movements WHERE session_id = _session_id AND type = 'suprimento';

  SELECT COALESCE(SUM(amount),0) INTO v_sangria
    FROM public.cash_movements WHERE session_id = _session_id AND type = 'sangria';

  RETURN COALESCE(v_opening,0) + v_cash_sales + v_suprimento - v_sangria;
END;
$$;