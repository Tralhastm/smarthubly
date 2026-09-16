-- Custos internos antes do repasse: fornecedor, checkout 4,99%, motoboy e desconto real.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_cost numeric(12,2) NOT NULL DEFAULT 50.00;

CREATE OR REPLACE FUNCTION public.calculate_seller_order_item_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_total numeric := 0;
  v_gross numeric := 0;
  v_share numeric := 0;
  v_supplier_cost numeric := 0;
  v_courier_cost numeric := 50;
  v_discount numeric := 0;
BEGIN
  SELECT COALESCE(total, 0), COALESCE(courier_cost, 50), COALESCE(discount_amount, 0)
  INTO v_order_total, v_courier_cost, v_discount
  FROM public.orders WHERE id = NEW.order_id;
  v_gross := GREATEST(COALESCE(NEW.line_total, 0), 0);
  v_share := CASE WHEN v_order_total > 0 THEN v_gross / v_order_total ELSE 0 END;
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT COALESCE(spp.unit_price, 0) INTO v_supplier_cost
    FROM public.supplier_product_prices spp
    WHERE spp.supplier_id = NEW.supplier_id
      AND lower(trim(spp.product_name)) = lower(trim(NEW.product_name))
    ORDER BY spp.updated_at DESC LIMIT 1;
  END IF;
  IF v_supplier_cost <= 0 AND NEW.product_id IS NOT NULL THEN
    SELECT COALESCE(original_price, 0) INTO v_supplier_cost
    FROM public.products WHERE id = NEW.product_id;
  END IF;
  NEW.cost_price := ROUND(v_supplier_cost * COALESCE(NEW.quantity, 1), 2);
  NEW.checkout_fee := ROUND(v_gross * 0.0499, 2);
  NEW.shipping_cost := ROUND(v_courier_cost * v_share, 2);
  NEW.other_costs := ROUND(v_discount * v_share, 2);
  NEW.net_profit := ROUND(GREATEST(v_gross - NEW.cost_price - NEW.checkout_fee - NEW.shipping_cost - NEW.other_costs, 0), 2);
  NEW.commission_percent := 20;
  NEW.commission_amount := TRUNC(NEW.net_profit * 0.20, 2);
  RETURN NEW;
END;
$$;
