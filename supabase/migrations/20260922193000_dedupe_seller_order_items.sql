-- Impede que o navegador recrie linhas de venda já materializadas pelo checkout.

DELETE FROM public.seller_order_items dup
WHERE dup.order_item_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.seller_order_items real
    WHERE real.order_id = dup.order_id
      AND real.seller_id = dup.seller_id
      AND real.order_item_id IS NOT NULL
      AND real.product_name = dup.product_name
      AND real.quantity = dup.quantity
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_order_items_order_item
  ON public.seller_order_items(order_id, seller_id, order_item_id)
  WHERE order_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reject_duplicate_orphan_seller_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_item_id IS NULL AND EXISTS (
    SELECT 1
    FROM public.seller_order_items existing
    WHERE existing.order_id = NEW.order_id
      AND existing.seller_id = NEW.seller_id
      AND existing.order_item_id IS NOT NULL
      AND existing.product_name = NEW.product_name
      AND existing.quantity = NEW.quantity
  ) THEN
    RAISE EXCEPTION 'duplicate_seller_order_item_for_order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_duplicate_orphan_seller_order_item
  ON public.seller_order_items;
CREATE TRIGGER trg_reject_duplicate_orphan_seller_order_item
BEFORE INSERT ON public.seller_order_items
FOR EACH ROW
EXECUTE FUNCTION public.reject_duplicate_orphan_seller_order_item();
