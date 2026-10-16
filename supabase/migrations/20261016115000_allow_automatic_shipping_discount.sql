-- A campanha automática de frete é uma regra explícita da loja, não um cupom.
-- Mantém a proteção contra frete zero arbitrário, mas libera pedidos quando a
-- própria loja habilitou o desconto automático global.
CREATE OR REPLACE FUNCTION public.require_code_for_free_shipping()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _automatic_shipping_discount_enabled boolean := false;
BEGIN
  IF NEW.delivery_type = 'delivery'
     AND COALESCE(NEW.delivery_fee, 0) <= 0
     AND NULLIF(BTRIM(COALESCE(NEW.coupon_code, '')), '') IS NULL
     AND NULLIF(BTRIM(COALESCE(NEW.seller_code_id, '')), '') IS NULL THEN
    SELECT COALESCE(t.shipping_discount_enabled, true)
           AND COALESCE(t.shipping_discount_auto, false)
      INTO _automatic_shipping_discount_enabled
      FROM public.tenants t
     WHERE t.id = NEW.tenant_id;

    IF NOT COALESCE(_automatic_shipping_discount_enabled, false) THEN
      RAISE EXCEPTION 'free_shipping_requires_coupon_or_seller_code';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.require_code_for_free_shipping() IS
  'Blocks free delivery orders unless a coupon, seller code, or the tenant automatic shipping campaign authorizes it.';
