-- A Margem Segura é uma regra comercial exclusiva da Mobiletec.
-- Os demais tenants permanecem com a política anterior de disponibilidade.

CREATE OR REPLACE FUNCTION public.apply_catalog_margin_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tenant text;
  v_reference numeric;
  v_cost numeric;
  v_profit numeric;
  v_safe numeric;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    SELECT tenant_id INTO v_tenant FROM public.products WHERE id = NEW.id;
    IF v_tenant IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21' THEN RETURN NEW; END IF;
    v_reference := COALESCE(NEW.pricing_reference_price, NEW.price, 0);
    v_cost := COALESCE(NEW.original_price, 0);
    v_profit := public.catalog_operating_profit(v_reference, v_cost);
    IF v_profit < 80 AND NOT COALESCE(NEW.allow_loss, false) THEN
      v_safe := GREATEST(v_reference, public.catalog_safe_sale_price(v_cost));
      UPDATE public.products SET price=v_safe, pricing_mode='margem_segura', pricing_reference_price=v_reference, in_stock=true, updated_at=now() WHERE id=NEW.id;
    ELSE
      UPDATE public.products SET pricing_mode='carro_chefe', pricing_reference_price=v_reference, updated_at=now() WHERE id=NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.products p WHERE p.id=NEW.product_id;
  IF v_tenant IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21' THEN RETURN NEW; END IF;
  v_reference := COALESCE(NEW.pricing_reference_delta, NEW.price_delta, 0);
  v_cost := COALESCE(NEW.cost_price, 0);
  v_profit := public.catalog_operating_profit(
    COALESCE((SELECT p.price FROM public.products p WHERE p.id=NEW.product_id),0)+v_reference,
    v_cost
  );
  IF v_profit < 80 AND NOT COALESCE(NEW.allow_loss, false) THEN
    v_safe := public.catalog_safe_sale_price(v_cost);
    UPDATE public.product_variants SET price_delta=ROUND(v_safe-COALESCE((SELECT p.price FROM public.products p WHERE p.id=NEW.product_id),0),2), pricing_mode='margem_segura', pricing_reference_delta=v_reference, in_stock=true, updated_at=now() WHERE id=NEW.id;
  ELSE
    UPDATE public.product_variants SET pricing_mode='carro_chefe', pricing_reference_delta=v_reference, updated_at=now() WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.products
SET price=COALESCE(pricing_reference_price,price), pricing_mode='carro_chefe',
    in_stock=CASE WHEN supplier_id IS NULL THEN in_stock ELSE
      (COALESCE(price,0)-(COALESCE(price,0)*0.0499)-50-10-COALESCE(original_price,0)>=0) END,
    updated_at=now()
WHERE tenant_id IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21';

UPDATE public.product_variants pv
SET price_delta=COALESCE(pricing_reference_delta,price_delta), pricing_mode='carro_chefe',
    in_stock=CASE WHEN supplier_id IS NULL THEN in_stock ELSE
      (COALESCE((SELECT p.price FROM public.products p WHERE p.id=pv.product_id),0)+COALESCE(pricing_reference_delta,price_delta,0)
       -((COALESCE((SELECT p.price FROM public.products p WHERE p.id=pv.product_id),0)+COALESCE(pricing_reference_delta,price_delta,0))*0.0499)
       -50-10-COALESCE(cost_price,0)>=0)::text END,
    updated_at=now()
WHERE (SELECT p.tenant_id FROM public.products p WHERE p.id=pv.product_id)
  IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21';
