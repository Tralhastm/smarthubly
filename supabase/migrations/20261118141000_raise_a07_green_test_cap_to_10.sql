-- Increase only the explicitly authorized Galaxy A07 green real-checkout test price to R$10.00.
-- Keep one unit, exact SKU/variant, online Mercado Pago, and no supplier/fulfillment guarantee.
COMMENT ON COLUMN public.product_variants.demo_stock_override IS
  'Temporary test-only stock override. For the authorized Galaxy A07 green SKU it may permit a one-unit Mercado Pago checkout at R$10.00, but never creates supplier inventory or guarantees fulfillment.';

CREATE OR REPLACE FUNCTION public.is_valid_demo_stock_override(
  p_order_id text,
  p_product_name text,
  p_variant_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
    JOIN public.products p ON p.tenant_id = o.tenant_id
    JOIN public.product_variants pv
      ON pv.product_id = p.id
     AND pv.tenant_id = p.tenant_id
    WHERE o.id = p_order_id
      AND t.demo_payment_enabled IS TRUE
      AND (
        COALESCE(o.metadata->>'demo_payment', 'false') = 'true'
        OR (
          COALESCE(o.metadata->>'test_stock_override_payment', 'false') = 'true'
          AND o.payment_flow = 'online'
          AND lower(COALESCE(o.payment_provider, '')) = 'mercadopago'
          AND o.total = 10.00
          AND public.catalog_product_match_key(p.name) =
              public.catalog_product_match_key('Galaxy A07 256GB/8GB')
          AND lower(trim(pv.name)) = 'verde'
          AND round(p.price + COALESCE(pv.price_delta, 0), 2) = 10.00
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(o.metadata->'test_stock_override_payment_items', '[]'::jsonb)
            ) AS test_item(item)
            WHERE public.catalog_product_match_key(
                    COALESCE(test_item.item->>'product_name', '')
                  ) = public.catalog_product_match_key(p.name)
              AND lower(trim(COALESCE(test_item.item->>'variant_name', ''))) = 'verde'
              AND COALESCE(NULLIF(test_item.item->>'quantity', '')::numeric, 0) = 1
              AND COALESCE(NULLIF(test_item.item->>'product_price', '')::numeric, 0) = 10.00
          )
        )
      )
      AND p.in_stock IS TRUE
      AND p.store_visible IS DISTINCT FROM false
      AND COALESCE(p.manual_blocked, false) IS FALSE
      AND COALESCE(p.catalog_conflict, false) IS FALSE
      AND pv.in_stock::text = 'true'
      AND pv.demo_stock_override IS TRUE
      AND public.catalog_product_match_key(p.name) =
          public.catalog_product_match_key(p_product_name)
      AND lower(trim(pv.name)) = lower(trim(p_variant_name))
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          COALESCE(o.metadata->'demo_stock_override_items', '[]'::jsonb)
        ) AS override_item(item)
        WHERE public.catalog_product_match_key(
                COALESCE(override_item.item->>'product_name', '')
              ) = public.catalog_product_match_key(p_product_name)
          AND lower(trim(COALESCE(override_item.item->>'variant_name', ''))) =
              lower(trim(p_variant_name))
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_valid_demo_stock_override(text, text, text)
  FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.checkout_place_order(_order jsonb, _items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order jsonb;
  v_metadata jsonb;
  v_test_item jsonb;
  v_order_id uuid;
  v_valid_test_stock boolean := false;
BEGIN
  IF COALESCE(_order->'metadata'->>'test_stock_override_payment', 'false') = 'true' THEN
    IF COALESCE(_order->>'payment_flow', '') <> 'online'
       OR lower(COALESCE(_order->>'payment_provider', '')) <> 'mercadopago'
       OR COALESCE(_order->'metadata'->>'demo_payment', 'false') = 'true'
       OR COALESCE(_order->>'payment_received', 'false') = 'true'
       OR COALESCE(NULLIF(_order->>'total', '')::numeric, 0) <> 10.00
       OR jsonb_array_length(COALESCE(_items, '[]'::jsonb)) <> 1 THEN
      RAISE EXCEPTION 'test_stock_checkout_scope_invalid';
    END IF;

    v_test_item := _items->0;
    IF COALESCE(NULLIF(v_test_item->>'quantity', '')::numeric, 0) <> 1
       OR COALESCE(NULLIF(v_test_item->>'product_price', '')::numeric, 0) <> 10.00 THEN
      RAISE EXCEPTION 'test_stock_checkout_scope_invalid';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.product_variants pv
        ON pv.product_id = p.id
       AND pv.tenant_id = p.tenant_id
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.tenant_id = (_order->>'tenant_id')
        AND (NULLIF(v_test_item->>'product_id', '') IS NULL
             OR p.id = v_test_item->>'product_id')
        AND (NULLIF(v_test_item->>'variant_id', '') IS NULL
             OR pv.id = v_test_item->>'variant_id')
        AND public.catalog_product_match_key(p.name) =
            public.catalog_product_match_key('Galaxy A07 256GB/8GB')
        AND public.catalog_product_match_key(
              COALESCE(v_test_item->>'product_name', '')
            ) = public.catalog_product_match_key(p.name)
        AND lower(trim(pv.name)) = 'verde'
        AND lower(trim(COALESCE(v_test_item->>'variant_name', ''))) = 'verde'
        AND pv.demo_stock_override IS TRUE
        AND pv.in_stock::text = 'true'
        AND p.in_stock IS TRUE
        AND p.store_visible IS DISTINCT FROM false
        AND COALESCE(p.manual_blocked, false) IS FALSE
        AND COALESCE(p.catalog_conflict, false) IS FALSE
        AND t.demo_payment_enabled IS TRUE
        AND round(p.price + COALESCE(pv.price_delta, 0), 2) = 10.00
    ) INTO v_valid_test_stock;

    IF NOT v_valid_test_stock THEN
      RAISE EXCEPTION 'test_stock_checkout_unavailable';
    END IF;

    -- place_order already skips supplier assignment for a validated DEMO line.
    -- Reuse that internal insertion path within this transaction, then persist
    -- the real-payment marker before the order becomes visible to the caller.
    v_metadata := CASE
      WHEN jsonb_typeof(_order->'metadata') = 'object' THEN _order->'metadata'
      ELSE '{}'::jsonb
    END || jsonb_build_object(
      'demo_payment', true,
      'test_stock_override_payment', true,
      'test_stock_override_payment_items', _items
    );
    v_order := jsonb_set(_order, '{metadata}', v_metadata, true);
    v_order_id := public.place_order(v_order, _items);

    UPDATE public.orders
    SET metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'demo_payment', false,
        'test_stock_override_payment', true
      )
    WHERE id::text = v_order_id::text;

    RETURN v_order_id;
  END IF;

  RETURN public.place_order(_order, _items);
END;
$function$;


GRANT EXECUTE ON FUNCTION public.checkout_place_order(jsonb, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
