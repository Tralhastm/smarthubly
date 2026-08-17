CREATE OR REPLACE FUNCTION public.place_order(_order jsonb, _items jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _payload jsonb;
  _cols text;
  _it jsonb;
BEGIN
  _payload := (SELECT jsonb_object_agg(k, v)
                 FROM jsonb_each(_order - 'id' - 'created_at' - 'updated_at') AS t(k, v)
                WHERE v <> 'null'::jsonb
                  AND EXISTS (SELECT 1 FROM information_schema.columns c
                               WHERE c.table_schema='public' AND c.table_name='orders' AND c.column_name = k));

  SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;

  EXECUTE format(
    'INSERT INTO public.orders (%s) SELECT %s FROM jsonb_populate_record(null::public.orders, $1) RETURNING id',
    _cols, _cols
  ) USING _payload INTO _id;

  FOR _it IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb))
  LOOP
    _payload := (SELECT jsonb_object_agg(k, v)
                   FROM jsonb_each((_it - 'id' - 'created_at') || jsonb_build_object('order_id', _id)) AS t(k, v)
                  WHERE EXISTS (SELECT 1 FROM information_schema.columns c
                                 WHERE c.table_schema='public' AND c.table_name='order_items' AND c.column_name = k));
    SELECT string_agg(format('%I', k), ',') INTO _cols FROM jsonb_object_keys(_payload) k;
    EXECUTE format(
      'INSERT INTO public.order_items (%s) SELECT %s FROM jsonb_populate_record(null::public.order_items, $1)',
      _cols, _cols
    ) USING _payload;
  END LOOP;

  RETURN _id;
END;
$$;