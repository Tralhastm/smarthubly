
-- INGREDIENTS
CREATE TABLE public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'un', -- g, kg, ml, L, un
  cost_per_unit numeric(12,4) NOT NULL DEFAULT 0,
  stock numeric(12,3) NOT NULL DEFAULT 0,
  stock_min numeric(12,3) NOT NULL DEFAULT 0,
  supplier text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingredients_tenant ON public.ingredients(tenant_id);
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant admins view ingredients" ON public.ingredients
  FOR SELECT USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant admins insert ingredients" ON public.ingredients
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant admins update ingredients" ON public.ingredients
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant admins delete ingredients" ON public.ingredients
  FOR DELETE USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_ingredients_updated BEFORE UPDATE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PRODUCT RECIPES
CREATE TABLE public.product_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, ingredient_id)
);
CREATE INDEX idx_recipes_product ON public.product_recipes(product_id);
CREATE INDEX idx_recipes_tenant ON public.product_recipes(tenant_id);
ALTER TABLE public.product_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant admins view recipes" ON public.product_recipes
  FOR SELECT USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant admins insert recipes" ON public.product_recipes
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant admins update recipes" ON public.product_recipes
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenant admins delete recipes" ON public.product_recipes
  FOR DELETE USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

-- CMV por produto
CREATE OR REPLACE FUNCTION public.calc_product_cmv(_product_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.quantity * i.cost_per_unit), 0)
  FROM public.product_recipes r
  JOIN public.ingredients i ON i.id = r.ingredient_id
  WHERE r.product_id = _product_id;
$$;

-- DRE do período
CREATE OR REPLACE FUNCTION public.get_dre(_tenant_id uuid, _from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revenue numeric := 0;
  v_cmv numeric := 0;
  v_expenses numeric := 0;
  v_platform_fee numeric := 0;
BEGIN
  -- Receita: financial_entries income
  SELECT COALESCE(SUM(amount), 0) INTO v_revenue
    FROM public.financial_entries
   WHERE tenant_id = _tenant_id AND type = 'income'
     AND date >= _from AND date <= _to;

  -- CMV estimado: soma do custo dos ingredientes de cada item vendido
  SELECT COALESCE(SUM(oi.quantity * public.calc_product_cmv(oi.product_id)), 0) INTO v_cmv
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
   WHERE o.tenant_id = _tenant_id
     AND o.status = 'delivered'
     AND o.created_at >= _from AND o.created_at <= _to
     AND oi.product_id IS NOT NULL;

  -- Taxa da plataforma (já registrada em financial_entries como expense)
  SELECT COALESCE(SUM(amount), 0) INTO v_platform_fee
    FROM public.financial_entries
   WHERE tenant_id = _tenant_id AND type = 'expense' AND category = 'taxa_plataforma'
     AND date >= _from AND date <= _to;

  -- Outras despesas
  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
    FROM public.financial_entries
   WHERE tenant_id = _tenant_id AND type = 'expense'
     AND COALESCE(category,'') <> 'taxa_plataforma'
     AND date >= _from AND date <= _to;

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
$$;
