
CREATE OR REPLACE FUNCTION public.consume_recipe_stock_on_delivered()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.status = 'delivered' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'delivered') THEN
    FOR r IN
      SELECT pr.ingredient_id, SUM(oi.quantity * pr.quantity) AS qty
        FROM public.order_items oi
        JOIN public.products p ON p.tenant_id = NEW.tenant_id AND p.name = oi.product_name
        JOIN public.product_recipes pr ON pr.product_id = p.id
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
DROP TRIGGER IF EXISTS trg_consume_recipe_stock_ins ON public.orders;
CREATE TRIGGER trg_consume_recipe_stock
AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.consume_recipe_stock_on_delivered();
CREATE TRIGGER trg_consume_recipe_stock_ins
AFTER INSERT ON public.orders FOR EACH ROW WHEN (NEW.status='delivered') EXECUTE FUNCTION public.consume_recipe_stock_on_delivered();
