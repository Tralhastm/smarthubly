-- Register one storefront product-detail click without exposing arbitrary insert fields.
CREATE OR REPLACE FUNCTION public.register_storefront_product_click(
  _tenant_id text,
  _product_id text,
  _user_agent text DEFAULT NULL,
  _referrer text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.products
    WHERE id = _product_id
      AND tenant_id = _tenant_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.affiliate_clicks (tenant_id, product_id, user_agent, referrer)
  VALUES (
    _tenant_id,
    _product_id,
    LEFT(_user_agent, 500),
    LEFT(_referrer, 500)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_storefront_product_click(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_storefront_product_click(text, text, text, text) TO anon, authenticated;
