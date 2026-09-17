-- Política de preço do catálogo:
-- * lucro operacional < R$80: Margem Segura, com alvo de R$100 antes do repasse;
-- * lucro operacional >= R$80: Carro-chefe, preservando o preço competitivo.
-- O lucro operacional considera custo do fornecedor, checkout de 4,99%,
-- logística padrão de R$50 e desconto padrão de R$10.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'carro_chefe',
  ADD COLUMN IF NOT EXISTS pricing_reference_price numeric(12,2);

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'carro_chefe',
  ADD COLUMN IF NOT EXISTS pricing_reference_delta numeric(12,2);

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_pricing_mode_check;
ALTER TABLE public.products ADD CONSTRAINT products_pricing_mode_check
  CHECK (pricing_mode IN ('margem_segura', 'carro_chefe'));
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_pricing_mode_check;
ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_pricing_mode_check
  CHECK (pricing_mode IN ('margem_segura', 'carro_chefe'));

COMMENT ON COLUMN public.products.pricing_mode IS 'margem_segura quando o lucro operacional de referência fica abaixo de R$80; carro_chefe nos demais casos.';
COMMENT ON COLUMN public.products.pricing_reference_price IS 'Preço competitivo de referência antes da aplicação automática da Margem Segura.';
COMMENT ON COLUMN public.product_variants.pricing_reference_delta IS 'Delta de preço de referência da variante antes da aplicação automática da Margem Segura.';

CREATE OR REPLACE FUNCTION public.catalog_operating_profit(
  p_sale numeric,
  p_cost numeric,
  p_shipping numeric DEFAULT 50,
  p_discount numeric DEFAULT 10
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND(COALESCE(p_sale, 0)
    - COALESCE(p_cost, 0)
    - (COALESCE(p_sale, 0) * 0.0499)
    - COALESCE(p_shipping, 50)
    - COALESCE(p_discount, 10), 2)
$$;

CREATE OR REPLACE FUNCTION public.catalog_safe_sale_price(
  p_cost numeric,
  p_shipping numeric DEFAULT 50,
  p_discount numeric DEFAULT 10,
  p_target_profit numeric DEFAULT 100
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CEIL(((COALESCE(p_cost, 0) + COALESCE(p_shipping, 50)
    + COALESCE(p_discount, 10) + COALESCE(p_target_profit, 100)) / (1 - 0.0499)) * 100) / 100
$$;

CREATE OR REPLACE FUNCTION public.apply_catalog_margin_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_reference numeric;
  v_cost numeric;
  v_profit numeric;
  v_safe numeric;
  v_mode text;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    v_reference := COALESCE(NEW.pricing_reference_price, NEW.price, 0);
    v_cost := COALESCE(NEW.original_price, 0);
    v_profit := public.catalog_operating_profit(v_reference, v_cost);
    IF v_profit < 80 AND NOT COALESCE(NEW.allow_loss, false) THEN
      v_safe := GREATEST(v_reference, public.catalog_safe_sale_price(v_cost));
      UPDATE public.products
         SET price = v_safe,
             pricing_mode = 'margem_segura',
             pricing_reference_price = v_reference,
             in_stock = true,
             updated_at = now()
       WHERE id = NEW.id;
    ELSE
      UPDATE public.products
         SET pricing_mode = 'carro_chefe',
             pricing_reference_price = v_reference,
             in_stock = CASE WHEN COALESCE(NEW.supplier_id, '') = '' THEN NEW.in_stock ELSE true END,
             updated_at = now()
       WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  v_reference := COALESCE(NEW.pricing_reference_delta, NEW.price_delta, 0);
  v_cost := COALESCE(NEW.cost_price, 0);
  v_profit := public.catalog_operating_profit(COALESCE((SELECT p.price FROM public.products p WHERE p.id = NEW.product_id), 0) + v_reference, v_cost);
  IF v_profit < 80 AND NOT COALESCE(NEW.allow_loss, false) THEN
    v_safe := public.catalog_safe_sale_price(v_cost);
    UPDATE public.product_variants
       SET price_delta = ROUND(v_safe - COALESCE((SELECT p.price FROM public.products p WHERE p.id = NEW.product_id), 0), 2),
           pricing_mode = 'margem_segura',
           pricing_reference_delta = v_reference,
           in_stock = true,
           updated_at = now()
     WHERE id = NEW.id;
  ELSE
    UPDATE public.product_variants
       SET pricing_mode = 'carro_chefe',
           pricing_reference_delta = v_reference,
           updated_at = now()
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_apply_catalog_margin_policy ON public.products;
CREATE TRIGGER products_apply_catalog_margin_policy
AFTER UPDATE OF original_price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.apply_catalog_margin_policy();

DROP TRIGGER IF EXISTS product_variants_apply_catalog_margin_policy ON public.product_variants;
CREATE TRIGGER product_variants_apply_catalog_margin_policy
AFTER UPDATE OF cost_price ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.apply_catalog_margin_policy();

-- Inicializa a referência com os preços atuais e aplica a política imediatamente.
UPDATE public.products
   SET pricing_reference_price = COALESCE(pricing_reference_price, price),
       pricing_mode = 'carro_chefe'
 WHERE pricing_reference_price IS NULL;
UPDATE public.product_variants
   SET pricing_reference_delta = COALESCE(pricing_reference_delta, price_delta, 0),
       pricing_mode = 'carro_chefe'
 WHERE pricing_reference_delta IS NULL;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.products WHERE supplier_id IS NOT NULL LOOP
    UPDATE public.products SET original_price = original_price WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM public.product_variants WHERE supplier_id IS NOT NULL LOOP
    UPDATE public.product_variants SET cost_price = cost_price WHERE id = r.id;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.catalog_operating_profit(numeric, numeric, numeric, numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.catalog_safe_sale_price(numeric, numeric, numeric, numeric) TO anon, authenticated, service_role;
