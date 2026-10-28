-- DRE financeiro: vendas entregues e taxas vêm dos pedidos automaticamente.
-- Entradas manuais continuam válidas, mas lançamentos automáticos são excluídos
-- para evitar dependência de lançamento manual e contagem dupla.
CREATE OR REPLACE FUNCTION public.get_dre(_tenant_id text, _from timestamp with time zone, _to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue numeric := 0;
  v_cmv numeric := 0;
  v_expenses numeric := 0;
  v_platform_fee numeric := 0;
BEGIN
  -- Receita realizada: pedidos entregues pagos. Fiado só entra quando quitado.
  SELECT COALESCE(SUM(o.total), 0)
    INTO v_revenue
    FROM public.orders o
   WHERE o.tenant_id = _tenant_id
     AND o.status = 'delivered'
     AND LOWER(COALESCE(o.payment_method, '')) <> 'fiado'
     AND o.created_at >= _from AND o.created_at <= _to;

  -- Outras entradas manuais, sem repetir a receita automática do pedido.
  SELECT v_revenue + COALESCE(SUM(fe.amount), 0)
    INTO v_revenue
    FROM public.financial_entries fe
   WHERE fe.tenant_id = _tenant_id
     AND fe.type = 'income'
     AND COALESCE(fe.description, '') NOT ILIKE '%#ORDER_REVENUE:%'
     AND fe.date >= _from AND fe.date <= _to;

  -- CMV dos pedidos realizados, sem fiado.
    SELECT COALESCE(SUM(oi.quantity * public.calc_product_cmv_v2(p.id::uuid)), 0)
    INTO v_cmv
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.products p ON p.name = oi.product_name AND p.tenant_id = o.tenant_id
   WHERE o.tenant_id = _tenant_id
     AND o.status = 'delivered'
     AND LOWER(COALESCE(o.payment_method, '')) <> 'fiado'
     AND o.created_at >= _from AND o.created_at <= _to;

  -- Taxas: pedido entregue + taxas manuais que não foram geradas pelo trigger.
  SELECT COALESCE(SUM(o.platform_fee), 0)
    INTO v_platform_fee
    FROM public.orders o
   WHERE o.tenant_id = _tenant_id
     AND o.status = 'delivered'
     AND LOWER(COALESCE(o.payment_method, '')) <> 'fiado'
     AND o.created_at >= _from AND o.created_at <= _to;

  SELECT v_platform_fee + COALESCE(SUM(fe.amount), 0)
    INTO v_platform_fee
    FROM public.financial_entries fe
   WHERE fe.tenant_id = _tenant_id
     AND fe.type = 'expense'
     AND fe.category = 'taxa_plataforma'
     AND COALESCE(fe.description, '') NOT ILIKE '%#PLATFORM_FEE:%'
     AND fe.date >= _from AND fe.date <= _to;

  -- Toda despesa operacional entra no lucro, independentemente de estar paga.
  SELECT COALESCE(SUM(fe.amount), 0)
    INTO v_expenses
    FROM public.financial_entries fe
   WHERE fe.tenant_id = _tenant_id
     AND fe.type = 'expense'
     AND COALESCE(fe.category, '') <> 'taxa_plataforma'
     AND fe.date >= _from AND fe.date <= _to;

  RETURN jsonb_build_object(
    'revenue', v_revenue,
    'cmv', v_cmv,
    'platform_fee', v_platform_fee,
    'expenses', v_expenses,
    'gross_profit', v_revenue - v_cmv,
    'gross_margin_pct', CASE WHEN v_revenue > 0 THEN ROUND(((v_revenue - v_cmv) / v_revenue * 100)::numeric, 2) ELSE 0 END,
    'net_profit', v_revenue - v_cmv - v_platform_fee - v_expenses
  );
END;
$function$;
