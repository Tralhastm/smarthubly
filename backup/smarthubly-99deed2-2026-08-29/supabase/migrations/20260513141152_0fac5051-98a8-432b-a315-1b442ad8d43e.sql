
-- 1. Coluna de e-mail do cliente em pedidos
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE public.cart_sessions ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- 2. Configurações de e-mail por loja
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS require_customer_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transactional_emails_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS marketing_emails_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brevo_sender_email TEXT,
  ADD COLUMN IF NOT EXISTS brevo_sender_name TEXT,
  ADD COLUMN IF NOT EXISTS abandoned_cart_email_enabled BOOLEAN NOT NULL DEFAULT false;

-- 3. Tabela de campanhas de marketing
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  preview_text TEXT,
  segment TEXT NOT NULL DEFAULT 'all',
  coupon_code TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipients_count INTEGER DEFAULT 0,
  succeeded_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_admin_select_campaigns" ON public.marketing_campaigns
  FOR SELECT USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant_admin_insert_campaigns" ON public.marketing_campaigns
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant_admin_update_campaigns" ON public.marketing_campaigns
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant_admin_delete_campaigns" ON public.marketing_campaigns
  FOR DELETE USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE TRIGGER trg_marketing_campaigns_updated_at
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Tabela de descadastros (opt-out marketing)
CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_admin_select_unsubscribes" ON public.email_unsubscribes
  FOR SELECT USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "anyone_can_unsubscribe" ON public.email_unsubscribes
  FOR INSERT WITH CHECK (true);

-- 5. Trigger que dispara e-mail transacional quando status do pedido muda
CREATE OR REPLACE FUNCTION public.trg_send_order_status_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant RECORD;
  v_template TEXT;
  v_url TEXT := 'https://zcnuvemvhhspfrvbttsw.supabase.co';
BEGIN
  -- Só dispara em mudança de status
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  -- Sem e-mail do cliente, nada a fazer
  IF NEW.customer_email IS NULL OR NEW.customer_email = '' THEN RETURN NEW; END IF;

  SELECT id, name, transactional_emails_enabled INTO v_tenant
    FROM public.tenants WHERE id = NEW.tenant_id;
  IF NOT FOUND OR v_tenant.transactional_emails_enabled = false THEN RETURN NEW; END IF;

  v_template := CASE NEW.status
    WHEN 'received' THEN 'order-confirmed'
    WHEN 'preparing' THEN 'order-confirmed'
    WHEN 'out-for-delivery' THEN 'order-out-for-delivery'
    WHEN 'ready-for-pickup' THEN 'order-ready-for-pickup'
    WHEN 'delivered' THEN 'order-delivered'
    ELSE NULL
  END;
  IF v_template IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-transactional-email',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object(
      'templateName', v_template,
      'recipientEmail', NEW.customer_email,
      'idempotencyKey', 'order-' || NEW.id || '-' || NEW.status,
      'templateData', jsonb_build_object(
        'customerName', COALESCE(NEW.customer_name,''),
        'tenantName', v_tenant.name,
        'orderId', substr(NEW.id::text,1,8),
        'total', NEW.total,
        'status', NEW.status
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_status_email ON public.orders;
CREATE TRIGGER trg_orders_status_email
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_send_order_status_email();

CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON public.orders(customer_email) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant ON public.marketing_campaigns(tenant_id, created_at DESC);
