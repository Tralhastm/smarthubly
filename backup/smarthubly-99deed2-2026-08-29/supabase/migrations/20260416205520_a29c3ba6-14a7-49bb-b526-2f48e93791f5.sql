
-- Add billing fields to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_frequency text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS billing_grace_days integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS billing_blocked_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_invoice_at timestamptz;

-- Create billing_invoices table
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  orders_count integer NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  due_date timestamptz NOT NULL,
  paid_at timestamptz,
  payment_declared_at timestamptz,
  payment_note text,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant ON public.billing_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status ON public.billing_invoices(status);

ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

-- Super admin: full access
CREATE POLICY "Super admins can view billing invoices"
ON public.billing_invoices FOR SELECT TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can insert billing invoices"
ON public.billing_invoices FOR INSERT TO authenticated
WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can update billing invoices"
ON public.billing_invoices FOR UPDATE TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can delete billing invoices"
ON public.billing_invoices FOR DELETE TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- Tenant admins: view own invoices
CREATE POLICY "Tenant admins can view own invoices"
ON public.billing_invoices FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- Tenant admins: declare payment (update only payment_declared_at, payment_note, status)
CREATE POLICY "Tenant admins can declare payment"
ON public.billing_invoices FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- Service role bypass for edge functions (anon used by cron call)
CREATE POLICY "Service role can manage invoices"
ON public.billing_invoices FOR ALL TO anon
USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER set_billing_invoices_updated_at
BEFORE UPDATE ON public.billing_invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
