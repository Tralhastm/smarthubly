-- Nome novo para evitar qualquer entrada obsoleta do schema cache do PostgREST.
CREATE OR REPLACE FUNCTION public.checkout_place_order(_order jsonb, _items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.place_order(_order, _items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_place_order(jsonb, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
