CREATE OR REPLACE FUNCTION public.place_order(_order jsonb, _items jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders
  SELECT * FROM jsonb_populate_record(
    null::public.orders,
    (_order - 'id' - 'created_at' - 'updated_at')
      || jsonb_build_object('id', _id, 'created_at', now(), 'updated_at', now())
  );

  IF jsonb_array_length(coalesce(_items, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.order_items
    SELECT * FROM jsonb_populate_recordset(
      null::public.order_items,
      (SELECT jsonb_agg((e - 'id' - 'created_at') || jsonb_build_object('id', gen_random_uuid(), 'order_id', _id, 'created_at', now()))
         FROM jsonb_array_elements(_items) e)
    );
  END IF;

  RETURN _id;
END;
$$;