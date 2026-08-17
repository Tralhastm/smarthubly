
-- Onda 1: Estoque profundo
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('entrada','saida','perda','ajuste','venda','transferencia')),
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  reason TEXT,
  batch_code TEXT,
  expires_at DATE,
  order_id UUID,
  operator_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON public.stock_movements(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient ON public.stock_movements(ingredient_id, created_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins manage stock movements"
ON public.stock_movements FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE POLICY "Platform admins see all stock movements"
ON public.stock_movements FOR SELECT
USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- Inventários (contagem cíclica)
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  counted_qty NUMERIC NOT NULL,
  system_qty NUMERIC NOT NULL,
  difference NUMERIC GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
  notes TEXT,
  operator_name TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_counts_tenant ON public.stock_counts(tenant_id, created_at DESC);
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins manage stock counts"
ON public.stock_counts FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- Trigger: ao registrar movimentação, atualiza saldo do ingrediente
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta NUMERIC;
BEGIN
  v_delta := CASE NEW.type
    WHEN 'entrada' THEN NEW.quantity
    WHEN 'ajuste' THEN NEW.quantity
    WHEN 'saida' THEN -NEW.quantity
    WHEN 'perda' THEN -NEW.quantity
    WHEN 'venda' THEN -NEW.quantity
    WHEN 'transferencia' THEN -NEW.quantity
    ELSE 0
  END;

  UPDATE public.ingredients
     SET stock = COALESCE(stock,0) + v_delta,
         updated_at = now()
   WHERE id = NEW.ingredient_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- Trigger: ao registrar contagem, gera movimentação 'ajuste' se diferença != 0
CREATE OR REPLACE FUNCTION public.apply_stock_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.counted_qty - NEW.system_qty) <> 0 THEN
    INSERT INTO public.stock_movements (tenant_id, ingredient_id, type, quantity, reason, operator_name)
    VALUES (NEW.tenant_id, NEW.ingredient_id, 'ajuste', (NEW.counted_qty - NEW.system_qty),
            'Inventário: ' || COALESCE(NEW.notes,''), NEW.operator_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_stock_count ON public.stock_counts;
CREATE TRIGGER trg_apply_stock_count
AFTER INSERT ON public.stock_counts
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_count();

-- Baixa automática ao entregar pedido (consome receitas dos produtos vendidos)
CREATE OR REPLACE FUNCTION public.consume_recipe_stock_on_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') THEN
    FOR r IN
      SELECT pr.ingredient_id, SUM(oi.quantity * pr.quantity) AS qty
        FROM public.order_items oi
        JOIN public.product_recipes pr ON pr.product_id = oi.product_id
       WHERE oi.order_id = NEW.id
       GROUP BY pr.ingredient_id
    LOOP
      INSERT INTO public.stock_movements (tenant_id, ingredient_id, type, quantity, reason, order_id)
      VALUES (NEW.tenant_id, r.ingredient_id, 'venda', r.qty,
              'Baixa automática pedido ' || substr(NEW.id::text,1,8), NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consume_recipe_stock ON public.orders;
CREATE TRIGGER trg_consume_recipe_stock
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.consume_recipe_stock_on_delivered();

-- View: ingredientes abaixo do mínimo (sugestão de compra)
CREATE OR REPLACE VIEW public.ingredients_low_stock AS
SELECT i.*,
       (COALESCE(i.stock_min,0) - COALESCE(i.stock,0)) AS shortage
  FROM public.ingredients i
 WHERE COALESCE(i.stock,0) <= COALESCE(i.stock_min,0)
   AND COALESCE(i.stock_min,0) > 0;
