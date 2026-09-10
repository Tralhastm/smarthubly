DROP FUNCTION IF EXISTS public.assign_order_driver_by_supplier_token(text, uuid, text);

CREATE OR REPLACE FUNCTION public.assign_order_driver_by_supplier_token(
  _supplier_token text,
  _order_id text,
  _driver_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier public.suppliers%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_driver public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_supplier
  FROM public.suppliers
  WHERE access_token = _supplier_token
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_supplier_token'; END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id::text = _order_id
    AND tenant_id::text = v_supplier.tenant_id::text
    AND (
      supplier_id::text = v_supplier.id::text
      OR EXISTS (
        SELECT 1 FROM public.order_fragments f
        WHERE f.order_id::text = orders.id::text AND f.supplier_id::text = v_supplier.id::text
      )
      OR EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id::text = orders.id::text AND oi.supplier_id::text = v_supplier.id::text
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_available_for_supplier'; END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id::text = _driver_id
    AND tenant_id::text = v_supplier.tenant_id::text
    AND active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'driver_not_available'; END IF;

  UPDATE public.orders
  SET driver_id = v_driver.id,
      lalamove_order_id = NULL,
      lalamove_status = NULL,
      lalamove_share_link = NULL,
      lalamove_driver_name = NULL,
      lalamove_driver_phone = NULL,
      lalamove_driver_plate = NULL,
      updated_at = now()
  WHERE id::text = _order_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_order_driver_by_supplier_token(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_order_driver_by_supplier_token(text, text, text) TO anon, authenticated;
