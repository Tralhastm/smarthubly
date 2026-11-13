-- Ranking determinístico da vitrine e vínculo auditável dos componentes dos combos.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS storefront_rank INTEGER,
  ADD COLUMN IF NOT EXISTS bundle_signature TEXT,
  ADD COLUMN IF NOT EXISTS bundle_source_suggestion_id TEXT;

CREATE INDEX IF NOT EXISTS idx_products_tenant_storefront_rank
  ON public.products (tenant_id, storefront_rank NULLS LAST, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_bundle_signature
  ON public.products (tenant_id, bundle_signature)
  WHERE bundle_signature IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_bundle_source_suggestion
  ON public.products (bundle_source_suggestion_id)
  WHERE bundle_source_suggestion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_combo_suggestions_pending_pair
  ON public.automation_suggestions (tenant_id, (payload->>'dedupe_key'))
  WHERE type = 'combo_suggestion' AND status = 'pending' AND payload ? 'dedupe_key';

ALTER TABLE public.products
  ADD CONSTRAINT products_bundle_source_suggestion_fkey
  FOREIGN KEY (bundle_source_suggestion_id)
  REFERENCES public.automation_suggestions(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.product_bundle_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bundle_product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  position SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_bundle_items_unique_component UNIQUE (bundle_product_id, component_product_id),
  CONSTRAINT product_bundle_items_not_self CHECK (bundle_product_id <> component_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_bundle_items_tenant
  ON public.product_bundle_items (tenant_id, bundle_product_id, position);

ALTER TABLE public.product_bundle_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundle_items TO authenticated;

CREATE POLICY product_bundle_items_tenant_admin_all
  ON public.product_bundle_items
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

GRANT SELECT ON public.product_bundle_items TO anon, authenticated;
CREATE POLICY product_bundle_items_storefront_read
  ON public.product_bundle_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.id = product_bundle_items.bundle_product_id
         AND p.tenant_id = product_bundle_items.tenant_id
         AND p.store_visible = true
         AND p.manual_blocked = false
    )
  );

CREATE OR REPLACE FUNCTION public.refresh_parent_bundle_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle RECORD;
BEGIN
  -- Combos são derivados dos componentes; não propague atualização para cima de novo.
  IF NEW.bundle_signature IS NOT NULL THEN
    RETURN NEW;
  END IF;

  FOR v_bundle IN
    SELECT b.id,
           b.tenant_id,
           BOOL_AND(COALESCE(c.in_stock, true) AND (c.stock_quantity IS NULL OR c.stock_quantity > 0)) AS available,
           CASE WHEN BOOL_AND(c.stock_quantity IS NOT NULL)
                THEN GREATEST(0, FLOOR(MIN(c.stock_quantity / bi.quantity)))
                ELSE NULL
           END AS available_quantity
      FROM public.product_bundle_items bi
      JOIN public.products b ON b.id = bi.bundle_product_id AND b.tenant_id = bi.tenant_id
      JOIN public.products c ON c.id = bi.component_product_id AND c.tenant_id = bi.tenant_id
     WHERE bi.tenant_id = NEW.tenant_id
       AND bi.component_product_id = NEW.id
       AND b.bundle_signature IS NOT NULL
     GROUP BY b.id, b.tenant_id
  LOOP
    UPDATE public.products
       SET in_stock = v_bundle.available,
           stock_quantity = v_bundle.available_quantity,
           updated_at = now()
     WHERE id = v_bundle.id
       AND tenant_id = v_bundle.tenant_id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_refresh_parent_bundle_stock ON public.products;
CREATE TRIGGER products_refresh_parent_bundle_stock
  AFTER UPDATE OF stock_quantity, in_stock ON public.products
  FOR EACH ROW
  WHEN (OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity OR OLD.in_stock IS DISTINCT FROM NEW.in_stock)
  EXECUTE FUNCTION public.refresh_parent_bundle_stock();

COMMENT ON COLUMN public.products.storefront_rank IS
  'Posição automática (1–5) no topo da vitrine; NULL usa a ordem padrão do catálogo.';
COMMENT ON COLUMN public.products.bundle_signature IS
  'Assinatura canônica dos dois componentes de um combo gerado por automação.';
COMMENT ON TABLE public.product_bundle_items IS
  'Componentes e quantidades de produtos combo criados após aprovação da sugestão.';

CREATE OR REPLACE FUNCTION public.get_combo_price_quote(
  _tenant_id TEXT,
  _product1_id TEXT,
  _product2_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p1 public.products%ROWTYPE;
  v_p2 public.products%ROWTYPE;
  v_minimum_profit NUMERIC := 0;
  v_seller_share NUMERIC := 0;
  v_general_fixed NUMERIC := 0;
  v_general_percent NUMERIC := 0;
  v_p1_fixed NUMERIC := 0;
  v_p1_percent NUMERIC := 0;
  v_p2_fixed NUMERIC := 0;
  v_p2_percent NUMERIC := 0;
  v_fixed NUMERIC := 0;
  v_percent NUMERIC := 0;
  v_regular NUMERIC := 0;
  v_cost NUMERIC := 0;
  v_min_price NUMERIC := 0;
  v_sale_price NUMERIC := 0;
  v_operating_profit NUMERIC := 0;
  v_final_profit NUMERIC := 0;
  v_i INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (
       public.has_role(auth.uid(), 'admin'::app_role, _tenant_id::uuid)
       OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
     ) THEN
    RAISE EXCEPTION 'Sem permissão para calcular preço de combo desta loja.';
  END IF;

  IF _product1_id IS NULL OR _product2_id IS NULL OR _product1_id = _product2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Os dois produtos do combo precisam ser diferentes.');
  END IF;

  SELECT * INTO v_p1
    FROM public.products p
   WHERE p.id = _product1_id
     AND p.tenant_id = _tenant_id
     AND COALESCE(p.store_visible, true)
     AND NOT COALESCE(p.manual_blocked, false)
     AND p.bundle_signature IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Um produto do combo não está mais visível nesta loja.');
  END IF;

  SELECT * INTO v_p2
    FROM public.products p
   WHERE p.id = _product2_id
     AND p.tenant_id = _tenant_id
     AND COALESCE(p.store_visible, true)
     AND NOT COALESCE(p.manual_blocked, false)
     AND p.bundle_signature IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Um produto do combo não está mais visível nesta loja.');
  END IF;

  IF COALESCE(v_p1.in_stock, true) = false OR COALESCE(v_p2.in_stock, true) = false
     OR (v_p1.stock_quantity IS NOT NULL AND v_p1.stock_quantity <= 0)
     OR (v_p2.stock_quantity IS NOT NULL AND v_p2.stock_quantity <= 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Um dos produtos está sem disponibilidade no momento.');
  END IF;

  IF COALESCE(v_p1.price, 0) <= 0 OR COALESCE(v_p2.price, 0) <= 0
     OR COALESCE(v_p1.original_price, 0) <= 0 OR COALESCE(v_p2.original_price, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastre preço e custo real dos dois produtos para calcular um combo seguro.');
  END IF;

  SELECT COALESCE(t.catalog_minimum_profit, 0),
         COALESCE(t.catalog_seller_share_percent, 0)
    INTO v_minimum_profit, v_seller_share
    FROM public.tenants t
   WHERE t.id = _tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A loja não foi encontrada.');
  END IF;

  SELECT
    COALESCE(SUM(e.amount) FILTER (WHERE e.amount_type <> 'percentage'), 0),
    COALESCE(SUM(e.amount) FILTER (WHERE e.amount_type = 'percentage'), 0)
    INTO v_general_fixed, v_general_percent
    FROM public.market_pricer_expenses e
   WHERE e.tenant_id = _tenant_id
     AND e.enabled = true
     AND e.product_id IS NULL;

  SELECT
    COALESCE(SUM(e.amount) FILTER (WHERE e.amount_type <> 'percentage'), 0),
    COALESCE(SUM(e.amount) FILTER (WHERE e.amount_type = 'percentage'), 0)
    INTO v_p1_fixed, v_p1_percent
    FROM public.market_pricer_expenses e
   WHERE e.tenant_id = _tenant_id
     AND e.enabled = true
     AND e.product_id = _product1_id;

  SELECT
    COALESCE(SUM(e.amount) FILTER (WHERE e.amount_type <> 'percentage'), 0),
    COALESCE(SUM(e.amount) FILTER (WHERE e.amount_type = 'percentage'), 0)
    INTO v_p2_fixed, v_p2_percent
    FROM public.market_pricer_expenses e
   WHERE e.tenant_id = _tenant_id
     AND e.enabled = true
     AND e.product_id = _product2_id;

  v_regular := COALESCE(v_p1.price, 0) + COALESCE(v_p2.price, 0);
  v_cost := COALESCE(v_p1.original_price, 0) + COALESCE(v_p2.original_price, 0);
  v_fixed := GREATEST(0, v_general_fixed) + GREATEST(0, v_p1_fixed) + GREATEST(0, v_p2_fixed);
  v_percent := GREATEST(0, v_general_percent)
    + GREATEST(0, v_p1_percent) * COALESCE(v_p1.price, 0) / NULLIF(v_regular, 0)
    + GREATEST(0, v_p2_percent) * COALESCE(v_p2.price, 0) / NULLIF(v_regular, 0);
  v_seller_share := LEAST(100, GREATEST(0, v_seller_share));
  v_minimum_profit := GREATEST(0, v_minimum_profit);

  IF v_regular <= 0 OR v_percent >= 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Os gastos percentuais cadastrados impedem calcular uma venda viável.');
  END IF;
  IF v_seller_share >= 100 AND v_minimum_profit > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A participação configurada deixa lucro líquido insuficiente para este combo.');
  END IF;

  IF v_seller_share >= 100 THEN
    v_min_price := CEIL(((v_cost + v_fixed) / (1 - v_percent / 100)) * 100) / 100;
  ELSE
    v_min_price := CEIL(((v_cost + v_fixed + v_minimum_profit / (1 - v_seller_share / 100))
                         / (1 - v_percent / 100)) * 100) / 100;
  END IF;

  v_sale_price := GREATEST(ROUND(v_regular * 0.95, 2), v_min_price);
  IF v_sale_price >= v_regular THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Com os custos e gastos atuais não é possível oferecer 5% de desconto sem perder a margem mínima.');
  END IF;

  FOR v_i IN 1..50 LOOP
    v_operating_profit := v_sale_price - v_cost - v_fixed - v_sale_price * v_percent / 100;
    v_final_profit := v_operating_profit - GREATEST(0, v_operating_profit) * v_seller_share / 100;
    EXIT WHEN v_final_profit + 0.0001 >= v_minimum_profit;
    v_sale_price := v_sale_price + 0.01;
    IF v_sale_price >= v_regular THEN
      RETURN jsonb_build_object('ok', false, 'error', 'O desconto não preserva o lucro mínimo configurado.');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'regular_total', ROUND(v_regular, 2),
    'total_cost', ROUND(v_cost, 2),
    'fixed_expenses', ROUND(v_fixed, 2),
    'percentage_expenses', ROUND(v_percent, 4),
    'minimum_profit', ROUND(v_minimum_profit, 2),
    'suggested_price', ROUND(v_sale_price, 2),
    'final_profit', ROUND(v_final_profit, 2),
    'margin_percent', CASE WHEN v_sale_price > 0 THEN ROUND((v_final_profit / v_sale_price) * 100, 2) ELSE 0 END,
    'discount_percent', CASE WHEN v_regular > 0 THEN ROUND(((v_regular - v_sale_price) / v_regular) * 100, 2) ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_combo_price_quote(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_combo_price_quote(TEXT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_combo_suggestion(_suggestion_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_suggestion public.automation_suggestions%ROWTYPE;
  v_p1 public.products%ROWTYPE;
  v_p2 public.products%ROWTYPE;
  v_quote JSONB;
  v_product_id TEXT;
  v_signature TEXT;
  v_name TEXT;
  v_description TEXT;
  v_image TEXT;
  v_media JSONB := '[]'::jsonb;
  v_in_stock BOOLEAN;
  v_stock_quantity NUMERIC;
  v_existing RECORD;
BEGIN
  SELECT * INTO v_suggestion
    FROM public.automation_suggestions
   WHERE id = _suggestion_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A sugestão não existe ou você não tem acesso a ela.';
  END IF;
  IF auth.uid() IS NULL OR NOT (
       public.has_role(auth.uid(), 'admin'::app_role, v_suggestion.tenant_id::uuid)
       OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
     ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar combo nesta loja.';
  END IF;
  IF v_suggestion.type <> 'combo_suggestion' THEN
    RAISE EXCEPTION 'Esta sugestão não é de combo.';
  END IF;
  IF v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta sugestão já foi revisada.';
  END IF;

  IF COALESCE(jsonb_typeof(v_suggestion.payload->'product_ids'), '') <> 'array' THEN
    RAISE EXCEPTION 'Esta sugestão antiga não contém dois produtos verificáveis; mantenha-a apenas como registro.';
  END IF;
  IF jsonb_array_length(v_suggestion.payload->'product_ids') <> 2 THEN
    RAISE EXCEPTION 'Esta sugestão antiga não contém dois produtos verificáveis; mantenha-a apenas como registro.';
  END IF;

  IF (v_suggestion.payload->'product_ids'->>0) < (v_suggestion.payload->'product_ids'->>1) THEN
    v_signature := (v_suggestion.payload->'product_ids'->>0) || '|' || (v_suggestion.payload->'product_ids'->>1);
  ELSE
    v_signature := (v_suggestion.payload->'product_ids'->>1) || '|' || (v_suggestion.payload->'product_ids'->>0);
  END IF;

  SELECT p.id, p.name, p.price, p.original_price
    INTO v_existing
    FROM public.products p
   WHERE p.tenant_id = v_suggestion.tenant_id
     AND p.bundle_signature = v_signature
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.automation_suggestions
       SET status = 'applied', acted_at = now(),
           payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
             'created_product_id', v_existing.id,
             'final_price', v_existing.price,
             'final_cost', v_existing.original_price,
             'reused_existing_combo', true
           )
     WHERE id = v_suggestion.id;
    RETURN jsonb_build_object('ok', true, 'product_id', v_existing.id, 'name', v_existing.name,
                              'price', v_existing.price, 'cost', v_existing.original_price,
                              'reused_existing_combo', true);
  END IF;

  v_quote := public.get_combo_price_quote(
    v_suggestion.tenant_id,
    v_suggestion.payload->'product_ids'->>0,
    v_suggestion.payload->'product_ids'->>1
  );
  IF COALESCE(v_quote->>'ok', 'false') <> 'true' THEN
    RAISE EXCEPTION '%', COALESCE(v_quote->>'error', 'Não foi possível calcular um preço seguro.');
  END IF;

  SELECT * INTO v_p1 FROM public.products
   WHERE id = v_suggestion.payload->'product_ids'->>0
     AND tenant_id = v_suggestion.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O primeiro produto já não está disponível.'; END IF;
  SELECT * INTO v_p2 FROM public.products
   WHERE id = v_suggestion.payload->'product_ids'->>1
     AND tenant_id = v_suggestion.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O segundo produto já não está disponível.'; END IF;

  v_product_id := gen_random_uuid()::text;
  v_name := LEFT('Combo: ' || v_p1.name || ' + ' || v_p2.name, 240);
  v_description := 'Combo recomendado a partir de compras conjuntas. Inclui 1 × ' || v_p1.name || ' e 1 × ' || v_p2.name || '.';
  v_image := COALESCE(NULLIF(v_p1.image, ''), NULLIF(v_p2.image, ''));
  IF NULLIF(v_p1.image, '') IS NOT NULL THEN
    v_media := v_media || jsonb_build_array(jsonb_build_object('type', 'image', 'url', v_p1.image, 'origin', 'combo-component'));
  END IF;
  IF NULLIF(v_p2.image, '') IS NOT NULL AND v_p2.image IS DISTINCT FROM v_p1.image THEN
    v_media := v_media || jsonb_build_array(jsonb_build_object('type', 'image', 'url', v_p2.image, 'origin', 'combo-component'));
  END IF;
  v_in_stock := COALESCE(v_p1.in_stock, true) AND COALESCE(v_p2.in_stock, true)
    AND (v_p1.stock_quantity IS NULL OR v_p1.stock_quantity > 0)
    AND (v_p2.stock_quantity IS NULL OR v_p2.stock_quantity > 0);
  IF v_p1.stock_quantity IS NOT NULL AND v_p2.stock_quantity IS NOT NULL THEN
    v_stock_quantity := LEAST(v_p1.stock_quantity, v_p2.stock_quantity);
  ELSE
    v_stock_quantity := NULL;
  END IF;

  INSERT INTO public.products (
    id, tenant_id, name, price, original_price, image, media, category,
    description, in_stock, stock_quantity, store_visible, manual_blocked,
    item_type, brand, condition, image_source, bundle_signature,
    bundle_source_suggestion_id, storefront_rank
  ) VALUES (
    v_product_id, v_suggestion.tenant_id, v_name,
    (v_quote->>'suggested_price')::numeric,
    (v_quote->>'total_cost')::numeric,
    v_image, v_media, 'Combos', v_description, v_in_stock, v_stock_quantity,
    true, false, 'product', 'Combo', 'new', 'combo-components', v_signature,
    v_suggestion.id, NULL
  );

  INSERT INTO public.product_bundle_items (tenant_id, bundle_product_id, component_product_id, quantity, position)
  VALUES
    (v_suggestion.tenant_id, v_product_id, v_p1.id, 1, 1),
    (v_suggestion.tenant_id, v_product_id, v_p2.id, 1, 2);

  UPDATE public.automation_suggestions
     SET status = 'applied', acted_at = now(),
         payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
           'created_product_id', v_product_id,
           'final_price', (v_quote->>'suggested_price')::numeric,
           'final_cost', (v_quote->>'total_cost')::numeric,
           'final_profit', (v_quote->>'final_profit')::numeric,
           'final_margin_percent', (v_quote->>'margin_percent')::numeric
         )
   WHERE id = v_suggestion.id;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product_id,
    'name', v_name,
    'price', (v_quote->>'suggested_price')::numeric,
    'cost', (v_quote->>'total_cost')::numeric,
    'final_profit', (v_quote->>'final_profit')::numeric,
    'margin_percent', (v_quote->>'margin_percent')::numeric,
    'reused_existing_combo', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_combo_suggestion(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_combo_suggestion(TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.approve_low_stock_promo(_suggestion_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_suggestion public.automation_suggestions%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_discount NUMERIC := 15;
  v_old_price NUMERIC;
  v_new_price NUMERIC;
BEGIN
  SELECT * INTO v_suggestion
    FROM public.automation_suggestions
   WHERE id = _suggestion_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A sugestão não existe ou você não tem acesso a ela.';
  END IF;
  IF auth.uid() IS NULL OR NOT (
       public.has_role(auth.uid(), 'admin'::app_role, v_suggestion.tenant_id::uuid)
       OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
     ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta promoção.';
  END IF;
  IF v_suggestion.type <> 'low_stock_promo' OR v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta sugestão não é uma promoção pendente.';
  END IF;

  IF COALESCE(NULLIF(v_suggestion.payload->>'suggested_discount_percent', '')::numeric, 15) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'O desconto da sugestão precisa ficar entre 1%% e 80%%.';
  END IF;
  v_discount := COALESCE(NULLIF(v_suggestion.payload->>'suggested_discount_percent', '')::numeric, 15);

  SELECT * INTO v_product
    FROM public.products p
   WHERE p.id = v_suggestion.payload->>'product_id'
     AND p.tenant_id = v_suggestion.tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O produto desta sugestão não existe mais.';
  END IF;
  IF v_product.stock_quantity IS NULL OR v_product.stock_quantity <= 0 OR v_product.stock_quantity > 5 THEN
    RAISE EXCEPTION 'O estoque mudou; esta sugestão de baixo estoque não está mais válida.';
  END IF;
  v_old_price := COALESCE(v_product.price, 0);
  IF v_old_price <= 0 THEN
    RAISE EXCEPTION 'O produto não tem preço de venda válido.';
  END IF;
  v_new_price := GREATEST(0.01, ROUND(v_old_price * (1 - v_discount / 100), 2));

  UPDATE public.products
     SET price = v_new_price,
         updated_at = now()
   WHERE id = v_product.id
     AND tenant_id = v_suggestion.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível atualizar o preço do produto; a sugestão continua pendente.';
  END IF;

  UPDATE public.tenants
     SET promo_active = true,
         promo_title = 'Estoque baixo — Oferta!',
         promo_text = format('%s%% off em %s! Últimas unidades.', v_discount, v_product.name)
   WHERE id = v_suggestion.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível publicar a oferta; a alteração de preço foi revertida.';
  END IF;

  UPDATE public.automation_suggestions
     SET status = 'applied',
         acted_at = now(),
         payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
           'promo_applied', true,
           'original_price', v_old_price,
           'final_price', v_new_price,
           'discount_percent', v_discount,
           'product_name', v_product.name
         )
   WHERE id = v_suggestion.id;

  RETURN jsonb_build_object(
    'ok', true,
    'product_name', v_product.name,
    'original_price', v_old_price,
    'final_price', v_new_price,
    'discount_percent', v_discount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_low_stock_promo(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_low_stock_promo(TEXT) TO authenticated;
