
-- ===== client_uuid: idempotência de criação de pedido (fila offline) =====
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_uuid UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_uuid
  ON public.orders(client_uuid)
  WHERE client_uuid IS NOT NULL;

-- ===== Cancelamento parcial por item =====
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cancelled_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE OR REPLACE FUNCTION public.cancel_order_item_partial(
  _order_item_id UUID,
  _qty NUMERIC,
  _reason TEXT DEFAULT NULL,
  _by TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_order RECORD;
  v_new_cancelled NUMERIC;
  v_value_refund NUMERIC;
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = _order_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id FOR UPDATE;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_already_cancelled');
  END IF;

  v_new_cancelled := COALESCE(v_item.cancelled_qty, 0) + _qty;
  IF _qty <= 0 OR v_new_cancelled > v_item.quantity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_qty', 'max', v_item.quantity - COALESCE(v_item.cancelled_qty, 0));
  END IF;

  v_value_refund := _qty * v_item.product_price;

  UPDATE public.order_items
     SET cancelled_qty = v_new_cancelled,
         cancelled_at = now(),
         cancelled_by = COALESCE(_by, cancelled_by),
         cancel_reason = COALESCE(_reason, cancel_reason)
   WHERE id = _order_item_id;

  -- Reduz total do pedido proporcionalmente
  UPDATE public.orders
     SET total = GREATEST(0, total - v_value_refund),
         updated_at = now()
   WHERE id = v_item.order_id;

  -- Estorna estoque proporcional (insere movimento de entrada se houver receita)
  INSERT INTO public.stock_movements (tenant_id, ingredient_id, type, quantity, reason, order_id)
  SELECT v_order.tenant_id, pr.ingredient_id, 'entrada',
         _qty * pr.quantity,
         'Estorno parcial item pedido ' || substr(v_order.id::text, 1, 8),
         v_order.id
    FROM public.products p
    JOIN public.product_recipes pr ON pr.product_id = p.id
   WHERE p.tenant_id = v_order.tenant_id AND p.name = v_item.product_name;

  -- Log no histórico
  INSERT INTO public.order_events (order_id, tenant_id, event_type, actor, description, metadata)
  VALUES (v_order.id, v_order.tenant_id, 'note', 'admin',
          'Item cancelado parcialmente: ' || v_item.product_name || ' x' || _qty::text
          || CASE WHEN _reason IS NOT NULL THEN ' — ' || _reason ELSE '' END,
          jsonb_build_object('item_id', _order_item_id, 'qty', _qty, 'refund', v_value_refund, 'by', _by));

  RETURN jsonb_build_object(
    'ok', true,
    'item_id', _order_item_id,
    'cancelled_qty', v_new_cancelled,
    'remaining_qty', v_item.quantity - v_new_cancelled,
    'refund_amount', v_value_refund
  );
END;
$$;
