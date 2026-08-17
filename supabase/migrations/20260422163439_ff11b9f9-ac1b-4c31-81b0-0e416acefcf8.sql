-- Tabela principal de fiado
CREATE TABLE public.credit_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL CHECK (amount > 0),
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  due_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | paid | overdue | defaulted
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_accounts_tenant ON public.credit_accounts(tenant_id);
CREATE INDEX idx_credit_accounts_status ON public.credit_accounts(status);
CREATE INDEX idx_credit_accounts_phone ON public.credit_accounts(tenant_id, customer_phone);

ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view credit accounts" ON public.credit_accounts FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can insert credit accounts" ON public.credit_accounts FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can update credit accounts" ON public.credit_accounts FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can delete credit accounts" ON public.credit_accounts FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- Pagamentos parciais
CREATE TABLE public.credit_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  credit_account_id UUID NOT NULL REFERENCES public.credit_accounts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_payments_account ON public.credit_payments(credit_account_id);

ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view credit payments" ON public.credit_payments FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can insert credit payments" ON public.credit_payments FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can delete credit payments" ON public.credit_payments FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- Trigger updated_at
CREATE TRIGGER trg_credit_accounts_updated
BEFORE UPDATE ON public.credit_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Função: marca atrasados automaticamente ao consultar
CREATE OR REPLACE FUNCTION public.mark_overdue_credits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.credit_accounts
  SET status = 'overdue'
  WHERE status = 'open' AND due_date < now() AND amount_paid < amount;
$$;