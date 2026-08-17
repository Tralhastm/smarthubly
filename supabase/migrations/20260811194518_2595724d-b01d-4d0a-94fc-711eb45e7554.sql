CREATE OR REPLACE FUNCTION public.place_order(_order jsonb, _items jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.orders SELECT * FROM jsonb_populate_record(null::public.orders, _order - 'id' - 'created_at' - 'updated_at')
  RETURNING id INTO _id;

  IF jsonb_array_length(coalesce(_items, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.order_items
    SELECT * FROM jsonb_populate_recordset(
      null::public.order_items,
      (SELECT jsonb_agg(e || jsonb_build_object('order_id', _id)) FROM jsonb_array_elements(_items) e)
    );
  END IF;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb) TO anon, authenticated;

DELETE FROM public.orders WHERE customer_name IN ('TESTE QA','TESTE QA2');