-- Mantém o preço de revenda exibido e o preço efetivo da variação sincronizados.
-- Antes, a política de margem atualizava somente price_delta. Como a vitrine usa
-- product.price + price_delta e o painel também exibe suggested_price, os dois
-- campos podiam divergir depois de uma atualização de custo.
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
    SELECT tenant_id INTO v_tenant
      FROM public.products
     WHERE id = NEW.id;
    IF v_tenant IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21' THEN
      RETURN NEW;
    END IF;

    v_sale := COALESCE(NEW.price, 0);
    v_cost := COALESCE(NEW.original_price, 0);
    v_profit := public.catalog_operating_profit(v_sale, v_cost);

    IF v_profit <= 100 AND NOT COALESCE(NEW.allow_loss, false) AND v_cost > 0 THEN
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
         SET pricing_mode = CASE WHEN v_profit <= 100 THEN 'margem_segura' ELSE 'carro_chefe' END,
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
  IF v_tenant IS DISTINCT FROM '490d0a8a-353d-4db8-ab53-2132adb60b21' THEN
    RETURN NEW;
  END IF;

  v_sale := ROUND(v_base + COALESCE(NEW.price_delta, 0), 2);
  v_cost := COALESCE(NEW.cost_price, 0);
  v_profit := public.catalog_operating_profit(v_sale, v_cost);

  IF v_profit <= 100 AND NOT COALESCE(NEW.allow_loss, false) AND v_cost > 0 THEN
    v_safe := public.catalog_safe_sale_price(v_cost, 50, 10, 100);
    UPDATE public.product_variants
       SET price_delta = ROUND(v_safe - v_base, 2),
           suggested_price = v_safe,
           pricing_mode = 'margem_segura',
           pricing_reference_delta = COALESCE(pricing_reference_delta, NEW.price_delta, 0),
           in_stock = true,
           updated_at = now()
     WHERE id = NEW.id;
  ELSE
    UPDATE public.product_variants
       SET suggested_price = CASE
             WHEN COALESCE(NEW.suggested_price, 0) > 0
               OR COALESCE(NEW.price_delta, 0) <> 0
             THEN v_sale
             ELSE NEW.suggested_price
           END,
           pricing_mode = CASE WHEN v_profit <= 100 THEN 'margem_segura' ELSE 'carro_chefe' END,
           pricing_reference_delta = COALESCE(pricing_reference_delta, NEW.price_delta, 0),
           updated_at = now()
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Corrige divergências históricas sem transformar uma variação realmente pendente
-- (sem suggested_price e com price_delta zero) em uma variação vendável.
UPDATE public.product_variants pv
   SET suggested_price = ROUND(p.price + pv.price_delta, 2),
       needs_price_review = false,
       updated_at = now()
  FROM public.products p
 WHERE p.id = pv.product_id
   AND p.tenant_id = '490d0a8a-353d-4db8-ab53-2132adb60b21'
   AND (COALESCE(pv.suggested_price, 0) > 0 OR COALESCE(pv.price_delta, 0) <> 0)
   AND ROUND(p.price + pv.price_delta, 2) > 0;

-- Reprocessa custos atuais para aplicar a mesma regra às linhas que ainda ficaram
-- abaixo da margem segura após a correção.
UPDATE public.product_variants pv
   SET cost_price = pv.cost_price
  FROM public.products p
 WHERE p.id = pv.product_id
   AND p.tenant_id = '490d0a8a-353d-4db8-ab53-2132adb60b21'
   AND pv.cost_price IS NOT NULL;
