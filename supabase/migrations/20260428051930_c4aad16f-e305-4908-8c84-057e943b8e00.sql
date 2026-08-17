
CREATE OR REPLACE FUNCTION public.log_order_revenue_entry(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_marker TEXT;
  v_exists INT;
  v_label TEXT;
  v_short TEXT;
BEGIN
  SELECT id, tenant_id, total, payment_method, status
    INTO v_order
    FROM public.orders
   WHERE id = _order_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_order.total IS NULL OR v_order.total <= 0 THEN RETURN FALSE; END IF;
  IF LOWER(COALESCE(v_order.payment_method,'')) = 'fiado' THEN RETURN FALSE; END IF;
  IF v_order.status <> 'delivered' THEN RETURN FALSE; END IF;

  v_marker := '#ORDER_REVENUE:' || _order_id::text;
  SELECT COUNT(*) INTO v_exists FROM public.financial_entries
    WHERE tenant_id = v_order.tenant_id AND description ILIKE '%' || v_marker || '%';
  IF v_exists > 0 THEN RETURN FALSE; END IF;

  v_short := UPPER(SUBSTR(_order_id::text, 1, 8));
  v_label := CASE WHEN v_order.payment_method IS NOT NULL AND v_order.payment_method <> ''
                  THEN ' (' || v_order.payment_method || ')' ELSE '' END;

  INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date, payment_method, paid)
  VALUES (
    v_order.tenant_id, 'income', 'venda',
    'Venda #' || v_short || v_label || ' ' || v_marker,
    v_order.total, now(),
    COALESCE(v_order.payment_method, 'outro'), true
  );
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_log_order_revenue_on_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') THEN
    PERFORM public.log_order_revenue_entry(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_log_revenue_on_delivered ON public.orders;
CREATE TRIGGER orders_log_revenue_on_delivered
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_log_order_revenue_on_delivered();

DROP TRIGGER IF EXISTS orders_log_revenue_on_insert ON public.orders;
CREATE TRIGGER orders_log_revenue_on_insert
AFTER INSERT ON public.orders
FOR EACH ROW
WHEN (NEW.status = 'delivered')
EXECUTE FUNCTION public.trg_log_order_revenue_on_delivered();
