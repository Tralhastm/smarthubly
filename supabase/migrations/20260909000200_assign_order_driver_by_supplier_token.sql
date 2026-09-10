CREATE OR REPLACE FUNCTION public.assign_order_driver_by_supplier_token(
  _supplier_token text,
  _order_id uuid,
  _driver_id uuid
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_supplier_token';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
    AND tenant_id = v_supplier.tenant_id
    AND (
      supplier_id = v_supplier.id
      OR EXISTS (
        SELECT 1 FROM public.order_fragments f
        WHERE f.order_id = orders.id AND f.supplier_id = v_supplier.id::text
      )
      OR EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = orders.id AND oi.supplier_id = v_supplier.id
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_available_for_supplier';
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = _driver_id
    AND tenant_id = v_supplier.tenant_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'driver_not_available';
  END IF;

  UPDATE public.orders
  SET driver_id = v_driver.id,
      lalamove_order_id = NULL,
      lalamove_status = NULL,
      lalamove_share_link = NULL,
      lalamove_driver_name = NULL,
      lalamove_driver_phone = NULL,
      lalamove_driver_plate = NULL,
      updated_at = now()
  WHERE id = v_order.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_order_driver_by_supplier_token(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_order_driver_by_supplier_token(text, uuid, uuid) TO anon, authenticated;
