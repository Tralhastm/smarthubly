-- =====================================================
-- ONDA 1 — Automações (#1, #2, #5, #22)
-- =====================================================

-- 1) Toggles de automação por tenant (todos opt-in/opt-out)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS auto_cancel_pending_payment BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_cancel_pending_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS auto_confirm_paid_orders BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_confirm_card_payments BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_log_platform_fee BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_low_stock_promo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_abandon_coupon BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_reorder_catalog BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_credit_reminders BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_weekly_report BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_categorize_nightly BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_combo_suggestion BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_peak_alert BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_review_response BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_phantom_alert BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_phantom_minutes INTEGER NOT NULL DEFAULT 8;

-- 2) Marcador de bloqueio escalonado (faturamento #22)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS billing_warning_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_degraded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_suspended_at TIMESTAMPTZ;

-- 3) Tabela de notificações internas (sugestões da Sofia que aguardam aprovação)
CREATE TABLE IF NOT EXISTS public.automation_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_suggestions_tenant ON public.automation_suggestions(tenant_id, status);

ALTER TABLE public.automation_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read suggestions"
ON public.automation_suggestions FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins update suggestions"
ON public.automation_suggestions FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "System inserts suggestions"
ON public.automation_suggestions FOR INSERT TO authenticated
WITH CHECK (true);

CREATE TRIGGER update_automation_suggestions_updated_at
BEFORE UPDATE ON public.automation_suggestions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Trigger para marcar pedidos cancelados por falta de pagamento (telemetria)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_cancelled BOOLEAN NOT NULL DEFAULT FALSE;

-- 5) Helper RPC (security definer) para o cron de cancelamento
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_orders()
RETURNS TABLE (cancelled_id UUID, tenant_id UUID, customer_phone TEXT, customer_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT o.id
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
    WHERE o.status = 'pending_payment'
      AND t.auto_cancel_pending_payment = TRUE
      AND o.created_at < now() - (t.auto_cancel_pending_minutes || ' minutes')::interval
    LIMIT 200
  ),
  upd AS (
    UPDATE public.orders o
       SET status = 'cancelled',
           cancel_reason = 'pending_payment_expired',
           auto_cancelled = TRUE,
           updated_at = now()
     FROM expired
     WHERE o.id = expired.id
   RETURNING o.id, o.tenant_id, o.customer_phone, o.customer_name
  )
  SELECT id, tenant_id, customer_phone, customer_name FROM upd;
END;
$$;

-- 6) RPC para platform_fee como financial_entry (idempotente via marker)
CREATE OR REPLACE FUNCTION public.log_platform_fee_entry(_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_marker TEXT;
  v_exists INT;
BEGIN
  SELECT o.id, o.tenant_id, o.platform_fee, o.status, t.auto_log_platform_fee
    INTO v_order
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.id = _order_id;

  IF NOT FOUND OR v_order.auto_log_platform_fee = FALSE THEN RETURN FALSE; END IF;
  IF v_order.platform_fee IS NULL OR v_order.platform_fee <= 0 THEN RETURN FALSE; END IF;
  IF v_order.status NOT IN ('delivered','received','preparing','ready-for-pickup','out-for-delivery') THEN RETURN FALSE; END IF;

  v_marker := '#PLATFORM_FEE:' || _order_id::text;
  SELECT COUNT(*) INTO v_exists FROM public.financial_entries
    WHERE tenant_id = v_order.tenant_id AND description ILIKE '%' || v_marker || '%';
  IF v_exists > 0 THEN RETURN FALSE; END IF;

  INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date)
  VALUES (
    v_order.tenant_id,
    'expense',
    'taxa_plataforma',
    'Taxa da plataforma — pedido ' || substr(_order_id::text, 1, 8) || ' ' || v_marker,
    v_order.platform_fee,
    now()
  );
  RETURN TRUE;
END;
$$;

-- 7) Trigger: ao marcar delivered, lança a taxa automaticamente
CREATE OR REPLACE FUNCTION public.trg_log_platform_fee_on_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') THEN
    PERFORM public.log_platform_fee_entry(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_platform_fee_on_delivered ON public.orders;
CREATE TRIGGER log_platform_fee_on_delivered
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_log_platform_fee_on_delivered();