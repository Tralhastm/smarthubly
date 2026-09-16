-- Painel individual de vendedor e repasse sobre lucro líquido positivo.
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS dashboard_token text;

UPDATE public.sellers
SET dashboard_token = gen_random_uuid()::text
WHERE dashboard_token IS NULL OR dashboard_token = '';

ALTER TABLE public.sellers
  ALTER COLUMN dashboard_token SET DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_dashboard_token
  ON public.sellers(dashboard_token);

ALTER TABLE public.seller_order_items
  ADD COLUMN IF NOT EXISTS product_id text REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkout_fee numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_costs numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_profit numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.seller_order_items
  ALTER COLUMN commission_percent SET DEFAULT 20;

-- O repasse é sempre 20% do lucro líquido positivo. O trigger impede que
-- valores enviados pelo navegador alterem custo, lucro ou comissão.
CREATE OR REPLACE FUNCTION public.calculate_seller_order_item_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost numeric := 0;
  v_order_total numeric := 0;
  v_delivery numeric := 0;
  v_platform numeric := 0;
  v_gross numeric := 0;
  v_share numeric := 0;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT COALESCE(original_price, 0) INTO v_cost
    FROM public.products WHERE id = NEW.product_id;
  END IF;

  SELECT COALESCE(total, 0), COALESCE(delivery_fee, 0), COALESCE(platform_fee, 0)
    INTO v_order_total, v_delivery, v_platform
  FROM public.orders WHERE id = NEW.order_id;

  v_gross := GREATEST(COALESCE(NEW.line_total, 0), 0);
  v_share := CASE WHEN v_order_total > 0 THEN v_gross / v_order_total ELSE 0 END;

  NEW.cost_price := ROUND(v_cost * COALESCE(NEW.quantity, 1), 2);
  NEW.checkout_fee := ROUND(v_gross * 0.0499, 2);
  NEW.shipping_cost := ROUND(v_delivery * v_share, 2);
  NEW.other_costs := ROUND(v_platform * v_share, 2);
  NEW.net_profit := ROUND(GREATEST(v_gross - NEW.cost_price - NEW.checkout_fee - NEW.shipping_cost - NEW.other_costs, 0), 2);
  NEW.commission_percent := 20;
  NEW.commission_amount := ROUND(NEW.net_profit * 0.20, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_order_items_financials ON public.seller_order_items;
CREATE TRIGGER seller_order_items_financials
BEFORE INSERT OR UPDATE OF product_id, quantity, line_total, order_id
ON public.seller_order_items
FOR EACH ROW EXECUTE FUNCTION public.calculate_seller_order_item_financials();

-- Endpoint público somente com token aleatório; não retorna endereço do pedido.
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
  SELECT jsonb_build_object(
    'id', s.id, 'tenant_id', s.tenant_id, 'name', s.name,
    'phone', s.phone, 'active', s.active, 'commission_percent', 20,
    'dashboard_token', s.dashboard_token
  ) INTO v_seller
  FROM public.sellers s
  WHERE s.dashboard_token = _token AND s.active = true;

  IF v_seller IS NULL THEN RETURN jsonb_build_object('error', 'Vendedor não encontrado ou inativo'); END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_codes
  FROM (
    SELECT id, code, discount_type, discount_value, active, max_uses, uses_count, expires_at, created_at
    FROM public.seller_codes WHERE seller_id = (v_seller->>'id')
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.name), '[]'::jsonb) INTO v_catalog
  FROM (
    SELECT id, name, description, image, price, original_price, in_stock,
           stock_quantity, category, subcategory, updated_at
    FROM public.products
    WHERE tenant_id = (v_seller->>'tenant_id')
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_orders
  FROM (
    SELECT o.id AS order_id, o.created_at, o.status, o.customer_name,
           o.customer_phone, o.customer_email, o.payment_method,
           o.total, o.discount_amount,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'product_name', soi.product_name, 'quantity', soi.quantity,
             'unit_price', soi.unit_price_after_discount, 'line_total', soi.line_total,
             'net_profit', soi.net_profit, 'commission_amount', soi.commission_amount
           ) ORDER BY soi.created_at) FROM public.seller_order_items soi WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), '[]'::jsonb) AS items,
           COALESCE((SELECT SUM(soi.quantity) FROM public.seller_order_items soi WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), 0) AS item_quantity,
           COALESCE((SELECT SUM(soi.line_total) FROM public.seller_order_items soi WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), 0) AS seller_sales,
           COALESCE((SELECT SUM(soi.net_profit) FROM public.seller_order_items soi WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), 0) AS net_profit,
           COALESCE((SELECT SUM(soi.commission_amount) FROM public.seller_order_items soi WHERE soi.order_id = o.id AND soi.seller_id = (v_seller->>'id')), 0) AS seller_amount
    FROM public.orders o
    WHERE o.seller_id = (v_seller->>'id')
  ) x;

  RETURN jsonb_build_object('seller', v_seller, 'codes', v_codes, 'catalog', v_catalog, 'orders', v_orders);
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_dashboard(text) TO anon, authenticated;
