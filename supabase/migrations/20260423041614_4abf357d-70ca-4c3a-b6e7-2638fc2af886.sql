-- 1. Adicionar tenant_id em push_subscriptions
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON public.push_subscriptions(tenant_id);

-- 2. Trigger que dispara edge function a cada novo pedido
CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fn_url text;
  service_key text;
BEGIN
  -- Apenas para pedidos vindos do cliente (não venda manual já 'delivered')
  IF NEW.status IN ('delivered', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Lê URL e service key do vault/settings (best-effort)
  BEGIN
    SELECT current_setting('app.supabase_url', true) INTO fn_url;
    SELECT current_setting('app.service_role_key', true) INTO service_key;
  EXCEPTION WHEN OTHERS THEN
    fn_url := NULL;
  END;

  -- Fallback: usa hardcoded do projeto (Lovable Cloud)
  IF fn_url IS NULL OR fn_url = '' THEN
    fn_url := 'https://zcnuvemvhhspfrvbttsw.supabase.co';
  END IF;

  -- Chama edge function async via pg_net (não bloqueia insert)
  PERFORM net.http_post(
    url := fn_url || '/functions/v1/notify-new-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'orderId', NEW.id,
      'tenantId', NEW.tenant_id,
      'customerName', NEW.customer_name,
      'total', NEW.total
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca falha o insert por causa de notificação
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_order ON public.orders;
CREATE TRIGGER trg_notify_new_order
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_order();