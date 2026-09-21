-- Frete grátis/descontado só pode ser concedido com cupom promocional
-- ou código de vendedor registrado no pedido.
CREATE OR REPLACE FUNCTION public.require_code_for_free_shipping()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivery_type = 'delivery'
     AND COALESCE(NEW.delivery_fee, 0) <= 0
     AND NULLIF(BTRIM(COALESCE(NEW.coupon_code, '')), '') IS NULL
     AND NULLIF(BTRIM(COALESCE(NEW.seller_code_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'free_shipping_requires_coupon_or_seller_code';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_code_for_free_shipping ON public.orders;
CREATE TRIGGER trg_require_code_for_free_shipping
  BEFORE INSERT OR UPDATE OF delivery_type, delivery_fee, coupon_code, seller_code_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.require_code_for_free_shipping();

COMMENT ON FUNCTION public.require_code_for_free_shipping() IS
  'Blocks free delivery orders unless a promotional coupon or seller code is present.';
