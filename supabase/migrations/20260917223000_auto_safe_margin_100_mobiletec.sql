-- Trava automática de margem da Mobiletec, aplicada individualmente por produto/variação.
-- Sempre que o custo do fornecedor mudar, o preço sobe automaticamente quando
-- o lucro operacional ficar abaixo de R$100 (R$80 loja + R$20 vendedor).
-- O cálculo inclui checkout 4,99%, motoboy R$50 e desconto padrão R$10.

CREATE OR REPLACE FUNCTION public.apply_catalog_margin_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tenant text;
  v_sale numeric;
  v_cost numeric;
  v_profit numeric;
  v_safe numeric;
  v_base numeric;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    SELECT tenant_id INTO v_tenant FROM public.products WHERE id = NEW.id;
    IF v_tenant IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21' THEN RETURN NEW; END IF;

    v_sale := COALESCE(NEW.price, 0);
    v_cost := COALESCE(NEW.original_price, 0);
    v_profit := public.catalog_operating_profit(v_sale, v_cost);

    IF v_profit < 100 AND NOT COALESCE(NEW.allow_loss, false) AND v_cost > 0 THEN
      v_safe := GREATEST(v_sale, public.catalog_safe_sale_price(v_cost, 50, 10, 100));
      UPDATE public.products
         SET price = v_safe,
             pricing_mode = 'margem_segura',
             pricing_reference_price = COALESCE(pricing_reference_price, v_sale),
             in_stock = true,
             updated_at = now()
       WHERE id = NEW.id;
    ELSE
      UPDATE public.products
         SET pricing_mode = CASE WHEN v_profit < 100 THEN 'margem_segura' ELSE 'carro_chefe' END,
             pricing_reference_price = COALESCE(pricing_reference_price, v_sale),
             updated_at = now()
       WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.tenant_id, COALESCE(p.price, 0)
    INTO v_tenant, v_base
    FROM public.products p
   WHERE p.id = NEW.product_id;
  IF v_tenant IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21' THEN RETURN NEW; END IF;

  v_sale := ROUND(v_base + COALESCE(NEW.price_delta, 0), 2);
  v_cost := COALESCE(NEW.cost_price, 0);
  v_profit := public.catalog_operating_profit(v_sale, v_cost);

  IF v_profit < 100 AND NOT COALESCE(NEW.allow_loss, false) AND v_cost > 0 THEN
    v_safe := public.catalog_safe_sale_price(v_cost, 50, 10, 100);
    UPDATE public.product_variants
       SET price_delta = ROUND(v_safe - v_base, 2),
           pricing_mode = 'margem_segura',
           pricing_reference_delta = COALESCE(pricing_reference_delta, NEW.price_delta, 0),
           in_stock = true,
           updated_at = now()
     WHERE id = NEW.id;
  ELSE
    UPDATE public.product_variants
       SET pricing_mode = CASE WHEN v_profit < 100 THEN 'margem_segura' ELSE 'carro_chefe' END,
           pricing_reference_delta = COALESCE(pricing_reference_delta, NEW.price_delta, 0),
           updated_at = now()
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Reprocessa todos os custos atuais. A própria trigger corrige imediatamente
-- qualquer produto/variação já abaixo do piso.
UPDATE public.products
   SET original_price = original_price
 WHERE tenant_id = '490d0a8a-353d-4db8-ab53-2132adb60b21'
   AND original_price IS NOT NULL;

UPDATE public.product_variants
   SET cost_price = cost_price
 WHERE product_id IN (
   SELECT id FROM public.products
   WHERE tenant_id = '490d0a8a-353d-4db8-ab53-2132adb60b21'
 )
 AND cost_price IS NOT NULL;
