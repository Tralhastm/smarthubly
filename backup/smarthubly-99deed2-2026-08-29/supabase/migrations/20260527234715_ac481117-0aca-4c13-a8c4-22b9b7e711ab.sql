
CREATE OR REPLACE FUNCTION public.consume_recipe_stock_on_item_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_status text;
  r RECORD;
BEGIN
  SELECT tenant_id, status INTO v_tenant, v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status = 'delivered' THEN
    FOR r IN
      SELECT pr.ingredient_id, NEW.quantity * pr.quantity AS qty
        FROM public.products p
        JOIN public.product_recipes pr ON pr.product_id = p.id
       WHERE p.tenant_id = v_tenant AND p.name = NEW.product_name
    LOOP
      INSERT INTO public.stock_movements (tenant_id, ingredient_id, type, quantity, reason, order_id)
      VALUES (v_tenant, r.ingredient_id, 'venda', r.qty,
              'Baixa automática item pedido ' || substr(NEW.order_id::text,1,8), NEW.order_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consume_recipe_on_item_insert ON public.order_items;
CREATE TRIGGER trg_consume_recipe_on_item_insert
AFTER INSERT ON public.order_items FOR EACH ROW
EXECUTE FUNCTION public.consume_recipe_stock_on_item_insert();
