-- Keep test orders out of automatic sales movement while retaining the orders
-- and all Mercado Pago/payment records for audit and reconciliation.

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
  SELECT id, tenant_id, total, payment_method, status, metadata
    INTO v_order
    FROM public.orders
   WHERE id = _order_id;

  IF NOT FOUND OR v_order.metadata->>'is_test_order' = 'true' THEN RETURN FALSE; END IF;
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

CREATE OR REPLACE FUNCTION public.log_platform_fee_entry(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_marker TEXT;
  v_exists INT;
BEGIN
  SELECT o.id, o.tenant_id, o.platform_fee, o.status, o.metadata,
         t.auto_log_platform_fee, t.billing_mode, t.society_billing_enabled
    INTO v_order
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.id = _order_id;

  IF NOT FOUND OR v_order.metadata->>'is_test_order' = 'true' THEN RETURN FALSE; END IF;
  IF v_order.auto_log_platform_fee = FALSE OR v_order.society_billing_enabled = TRUE THEN RETURN FALSE; END IF;
  IF v_order.billing_mode = 'monthly_fixed' OR v_order.platform_fee IS NULL OR v_order.platform_fee <= 0 THEN RETURN FALSE; END IF;
  IF v_order.status <> 'delivered' THEN RETURN FALSE; END IF;

  v_marker := '#PLATFORM_FEE:' || _order_id::text;
  SELECT COUNT(*) INTO v_exists FROM public.financial_entries
   WHERE tenant_id = v_order.tenant_id AND description ILIKE '%' || v_marker || '%';
  IF v_exists > 0 THEN RETURN FALSE; END IF;

  INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date)
  VALUES (v_order.tenant_id, 'expense', 'taxa_plataforma',
          'Taxa da plataforma — pedido ' || substr(_order_id::text, 1, 8) || ' ' || v_marker,
          v_order.platform_fee, now());
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_order_revenue_entry(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_marker TEXT;
  v_reverse_marker TEXT;
  v_orig_amount NUMERIC;
  v_exists INT;
BEGIN
  SELECT id, tenant_id, payment_method, metadata
    INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR v_order.metadata->>'is_test_order' = 'true' THEN RETURN FALSE; END IF;

  v_marker := '#ORDER_REVENUE:' || _order_id::text;
  v_reverse_marker := '#ORDER_REVENUE_REVERSAL:' || _order_id::text;

  SELECT COUNT(*) INTO v_exists FROM public.financial_entries
    WHERE tenant_id = v_order.tenant_id AND description ILIKE '%' || v_reverse_marker || '%';
  IF v_exists > 0 THEN RETURN FALSE; END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_orig_amount FROM public.financial_entries
    WHERE tenant_id = v_order.tenant_id AND type='income' AND description ILIKE '%' || v_marker || '%';
  IF v_orig_amount <= 0 THEN RETURN FALSE; END IF;

  INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date, payment_method, paid)
  VALUES (v_order.tenant_id, 'expense', 'estorno_venda',
          'Estorno cancelamento pedido ' || substr(_order_id::text,1,8) || ' ' || v_reverse_marker,
          v_orig_amount, now(), COALESCE(v_order.payment_method,'outro'), true);

  DECLARE v_fee_marker TEXT := '#PLATFORM_FEE:' || _order_id::text;
          v_fee_amount NUMERIC;
  BEGIN
    SELECT COALESCE(SUM(amount),0) INTO v_fee_amount FROM public.financial_entries
      WHERE tenant_id = v_order.tenant_id AND type='expense' AND category='taxa_plataforma'
        AND description ILIKE '%' || v_fee_marker || '%';
    IF v_fee_amount > 0 THEN
      INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date, paid)
      VALUES (v_order.tenant_id, 'income', 'estorno_taxa_plataforma',
              'Estorno taxa plataforma pedido ' || substr(_order_id::text,1,8) || ' #PLATFORM_FEE_REVERSAL:' || _order_id::text,
              v_fee_amount, now(), true);
    END IF;
  END;

  RETURN TRUE;
END;
$$;
