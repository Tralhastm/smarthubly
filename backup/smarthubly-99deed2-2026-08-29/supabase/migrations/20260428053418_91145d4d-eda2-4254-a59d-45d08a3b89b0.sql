-- Corrige log_platform_fee_entry para NÃO registrar taxa por pedido em lojas com billing_mode = 'monthly_fixed'
CREATE OR REPLACE FUNCTION public.log_platform_fee_entry(_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_marker TEXT;
  v_exists INT;
BEGIN
  SELECT o.id, o.tenant_id, o.platform_fee, o.status, t.auto_log_platform_fee, t.billing_mode
    INTO v_order
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.id = _order_id;

  IF NOT FOUND OR v_order.auto_log_platform_fee = FALSE THEN RETURN FALSE; END IF;
  -- Lojas com mensalidade fixa NÃO pagam taxa por pedido
  IF v_order.billing_mode = 'monthly_fixed' THEN RETURN FALSE; END IF;
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
$function$;

-- Zera platform_fee em pedidos de lojas mensais (corrige dado errado já gravado)
UPDATE public.orders o
   SET platform_fee = 0
  FROM public.tenants t
 WHERE o.tenant_id = t.id
   AND t.billing_mode = 'monthly_fixed'
   AND COALESCE(o.platform_fee, 0) > 0;

-- Remove lançamentos financeiros de "taxa_plataforma" criados indevidamente para lojas mensais
DELETE FROM public.financial_entries fe
 USING public.tenants t
 WHERE fe.tenant_id = t.id
   AND t.billing_mode = 'monthly_fixed'
   AND fe.category = 'taxa_plataforma';