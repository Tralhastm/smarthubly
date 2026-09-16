-- O painel público do vendedor nunca deve retornar custo de fornecedor,
-- taxa, logística, margem ou lucro interno. Ele retorna apenas vendas e repasse.
CREATE OR REPLACE FUNCTION public.get_seller_dashboard(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller jsonb;
  v_codes jsonb;
  v_catalog jsonb;
  v_orders jsonb;
BEGIN
  SELECT to_jsonb(s) - 'dashboard_token' - 'commission_percent'
  INTO v_seller
  FROM public.sellers s
  WHERE s.dashboard_token = _token AND s.active = true;

  IF v_seller IS NULL THEN
    RETURN jsonb_build_object('error', 'Vendedor não encontrado ou inativo');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_codes
  FROM (
    SELECT id, code, discount_type, discount_value, active, max_uses, uses_count, expires_at, created_at
    FROM public.seller_codes WHERE seller_id = (v_seller->>'id')
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.name), '[]'::jsonb)
  INTO v_catalog
  FROM (
    SELECT id, name, description, image, price, original_price, in_stock,
           stock_quantity, category, subcategory, updated_at
    FROM public.products WHERE tenant_id = (v_seller->>'tenant_id')
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_orders
  FROM (
    SELECT o.id AS order_id, o.created_at, o.status, o.customer_name,
           o.customer_phone, o.customer_email, o.payment_method,
           o.total, o.discount_amount,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'product_name', soi.product_name,
             'quantity', soi.quantity,
             'unit_price', soi.unit_price_after_discount,
             'line_total', soi.line_total
           ) ORDER BY soi.created_at)
           FROM public.seller_order_items soi
           WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), '[]'::jsonb) AS items,
           COALESCE((SELECT SUM(soi.quantity) FROM public.seller_order_items soi
             WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), 0) AS item_quantity,
           COALESCE((SELECT SUM(soi.line_total) FROM public.seller_order_items soi
             WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), 0) AS seller_sales,
           COALESCE((SELECT SUM(soi.commission_amount) FROM public.seller_order_items soi
             WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), 0) AS seller_amount
    FROM public.orders o
    WHERE o.seller_id = (v_seller->>'id')
  ) x;

  RETURN jsonb_build_object('seller', v_seller, 'codes', v_codes, 'catalog', v_catalog, 'orders', v_orders);
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_dashboard(text) TO anon, authenticated;
