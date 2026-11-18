-- Exceção temporária de estoque exclusivamente para compras de demonstração.
-- A flag só libera checkout quando a loja está em demo_payment_enabled e o
-- pedido marca metadata.demo_payment=true. Itens de teste não são atribuídos a
-- fornecedores, não geram order_fragments nem entram no ledger de afiliados.

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS demo_stock_override boolean NOT NULL DEFAULT false;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS demo_stock_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_variants.demo_stock_override IS
  'Exceção de estoque apenas para teste DEMO. Só é honrada com demo_payment_enabled=true e metadata.demo_payment=true; não representa estoque real nem deve gerar encaminhamento a fornecedor.';

COMMENT ON COLUMN public.order_items.demo_stock_override IS
  'Marca uma linha de pedido criada pelo RPC como teste DEMO sem fornecedor; validada contra pedido, loja e variante.';

CREATE OR REPLACE FUNCTION public.enforce_supplier_inventory_truth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_valid_offer boolean := false;
  v_has_variants boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF COALESCE(NEW.manual_blocked, false) THEN
      NEW.in_stock := false;
      RETURN NEW;
    END IF;

    IF COALESCE(NEW.in_stock, false) = false THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      WHERE pv.product_id = NEW.id
        AND pv.tenant_id = NEW.tenant_id
    ) INTO v_has_variants;

    IF v_has_variants THEN
      -- O estoque DEMO é válido apenas para uma variante explicitamente
      -- marcada, ainda disponível e em loja com pagamento DEMO habilitado.
      SELECT
        EXISTS (
          SELECT 1
          FROM public.product_variants pv
          JOIN public.tenants t ON t.id = pv.tenant_id
          WHERE pv.product_id = NEW.id
            AND pv.tenant_id = NEW.tenant_id
            AND pv.demo_stock_override IS TRUE
            AND pv.in_stock::text = 'true'
            AND t.demo_payment_enabled IS TRUE
        )
        OR EXISTS (
          SELECT 1
          FROM public.product_variants pv
          JOIN public.supplier_variant_offers svo
            ON svo.product_variant_id = pv.id
           AND svo.tenant_id = NEW.tenant_id
           AND svo.available = true
           AND svo.unit_cost IS NOT NULL
          JOIN public.supplier_catalog_snapshots cs
            ON cs.id = svo.snapshot_id
           AND cs.supplier_id = svo.supplier_id
           AND cs.tenant_id = NEW.tenant_id
           AND cs.status = 'completed'
          JOIN public.supplier_catalog_archives a
            ON a.id = svo.source_archive_id
           AND a.expires_at > now()
          WHERE pv.product_id = NEW.id
            AND pv.tenant_id = NEW.tenant_id
        )
      INTO v_valid_offer;
    ELSE
      -- Produto sem variações: linha genérica da lista continua válida.
      SELECT EXISTS (
        SELECT 1
        FROM public.supplier_product_prices spp
        JOIN public.suppliers s
          ON s.id = spp.supplier_id
         AND s.tenant_id = NEW.tenant_id
        JOIN public.supplier_catalog_snapshots cs
          ON cs.supplier_id = spp.supplier_id
         AND cs.archive_id = spp.source_archive_id
         AND cs.tenant_id = NEW.tenant_id
         AND cs.status = 'completed'
        JOIN public.supplier_catalog_archives a
          ON a.id = spp.source_archive_id
         AND a.expires_at > now()
        WHERE spp.available = true
          AND spp.unit_price IS NOT NULL
          AND public.catalog_product_match_key(spp.product_name) =
              public.catalog_product_match_key(NEW.name)
      ) INTO v_valid_offer;
    END IF;

    IF NOT v_valid_offer THEN
      NEW.in_stock := false;
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.in_stock::text, 'false') = 'false' THEN
    RETURN NEW;
  END IF;

  -- Override por variante só vale enquanto o modo de pagamento DEMO da loja
  -- estiver habilitado. O RPC place_order também exige metadata.demo_payment.
  IF COALESCE(NEW.demo_stock_override, false) IS TRUE
     AND EXISTS (
       SELECT 1
       FROM public.tenants t
       WHERE t.id = NEW.tenant_id
         AND t.demo_payment_enabled IS TRUE
     ) THEN
    RETURN NEW;
  END IF;

  -- Uma variação normal só pode ficar disponível com oferta explícita da
  -- própria variação e do fornecedor atualmente atribuído.
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_variant_offers svo
    JOIN public.supplier_catalog_snapshots cs
      ON cs.id = svo.snapshot_id
     AND cs.supplier_id = svo.supplier_id
     AND cs.tenant_id = NEW.tenant_id
     AND cs.status = 'completed'
    JOIN public.supplier_catalog_archives a
      ON a.id = svo.source_archive_id
     AND a.expires_at > now()
    WHERE svo.tenant_id = NEW.tenant_id
      AND svo.product_variant_id = NEW.id
      AND svo.supplier_id = NEW.supplier_id
      AND svo.available = true
      AND svo.unit_cost IS NOT NULL
  ) INTO v_valid_offer;

  IF NOT v_valid_offer THEN
    NEW.in_stock := 'false';
  END IF;
  RETURN NEW;
END;
$function$;

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
      AND COALESCE(o.metadata->>'demo_payment', 'false') = 'true'
      AND t.demo_payment_enabled IS TRUE
      AND p.in_stock IS TRUE
      AND p.store_visible IS DISTINCT FROM false
      AND COALESCE(p.manual_blocked, false) IS FALSE
      AND pv.in_stock::text = 'true'
      AND pv.demo_stock_override IS TRUE
      AND public.catalog_product_match_key(p.name) =
          public.catalog_product_match_key(p_product_name)
      AND lower(trim(pv.name)) = lower(trim(p_variant_name))
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          COALESCE(o.metadata->'demo_stock_override_items', '[]'::jsonb)
        ) AS test_item(item)
        WHERE public.catalog_product_match_key(
                COALESCE(test_item.item->>'product_name', '')
              ) = public.catalog_product_match_key(p_product_name)
          AND lower(trim(COALESCE(test_item.item->>'variant_name', ''))) =
              lower(trim(p_variant_name))
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_valid_demo_stock_override(text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clear_demo_stock_overrides_when_demo_mode_off()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(OLD.demo_payment_enabled, false) IS TRUE
     AND COALESCE(NEW.demo_payment_enabled, false) IS FALSE THEN
    UPDATE public.product_variants
    SET demo_stock_override = false,
        in_stock = 'true',
        updated_at = now()
    WHERE tenant_id = NEW.id
      AND demo_stock_override IS TRUE;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenants_clear_demo_stock_overrides ON public.tenants;
CREATE TRIGGER tenants_clear_demo_stock_overrides
AFTER UPDATE OF demo_payment_enabled ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.clear_demo_stock_overrides_when_demo_mode_off();

CREATE OR REPLACE FUNCTION public.assign_cheapest_supplier_to_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id text;
  v_supplier_id text;
  v_variant_id text;
  v_demo_payment text := 'false';
BEGIN
  SELECT o.tenant_id, COALESCE(o.metadata->>'demo_payment', 'false')
  INTO v_tenant_id, v_demo_payment
  FROM public.orders o
  WHERE o.id = NEW.order_id
  LIMIT 1;

  IF COALESCE(NEW.demo_stock_override, false) IS TRUE
     AND v_demo_payment = 'true'
     AND public.is_valid_demo_stock_override(
       NEW.order_id,
       NEW.product_name,
       COALESCE(NEW.variant_name, '')
     ) THEN
    NEW.supplier_id := NULL;
    RETURN NEW;
  END IF;

  -- Uma flag não validada pelo pedido/loja/variante não pode suprimir o
  -- encaminhamento normal do item.
  NEW.demo_stock_override := false;

  IF NEW.variant_name IS NOT NULL AND btrim(NEW.variant_name) <> '' THEN
    SELECT pv.id
    INTO v_variant_id
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE p.tenant_id = v_tenant_id
      AND public.catalog_product_match_key(p.name) =
          public.catalog_product_match_key(NEW.product_name)
      AND public.normalize_supplier_product_name(pv.name) =
          public.normalize_supplier_product_name(NEW.variant_name)
    LIMIT 1;

    IF v_variant_id IS NOT NULL THEN
      SELECT svo.supplier_id
      INTO v_supplier_id
      FROM public.supplier_variant_offers svo
      JOIN public.suppliers s ON s.id = svo.supplier_id
      WHERE svo.tenant_id = v_tenant_id
        AND svo.product_variant_id = v_variant_id
        AND svo.available = true
        AND s.active = 'true'
      ORDER BY svo.unit_cost ASC, svo.updated_at DESC, svo.supplier_id ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_supplier_id IS NULL THEN
    SELECT c.supplier_id
    INTO v_supplier_id
    FROM public.choose_cheapest_supplier(v_tenant_id, NEW.product_name) c
    LIMIT 1;
  END IF;

  IF v_supplier_id IS NOT NULL THEN
    NEW.supplier_id := v_supplier_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rebuild_order_fragments_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id text;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  DELETE FROM public.order_fragments
  WHERE order_id = v_order_id;

  INSERT INTO public.order_fragments (
    order_id,
    tenant_id,
    supplier_id,
    items,
    total,
    status,
    metadata
  )
  SELECT
    oi.order_id,
    o.tenant_id,
    oi.supplier_id,
    jsonb_agg(
      jsonb_build_object(
        'product_name', oi.product_name,
        'variant_name', oi.variant_name,
        'quantity', oi.quantity,
        'product_price', oi.product_price,
        'addons', oi.addons,
        'notes', oi.notes
      ) ORDER BY oi.created_at
    ),
    sum(oi.product_price * oi.quantity),
    o.status,
    jsonb_build_object('source', 'order_items_supplier_route')
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.order_id = v_order_id
    AND oi.supplier_id IS NOT NULL
    AND NOT (
      COALESCE(oi.demo_stock_override, false) IS TRUE
      AND public.is_valid_demo_stock_override(
        oi.order_id,
        oi.product_name,
        COALESCE(oi.variant_name, '')
      )
    )
  GROUP BY oi.order_id, o.tenant_id, oi.supplier_id, o.status;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_seller_sale_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders%ROWTYPE;
  c public.seller_codes%ROWTYPE;
  s public.sellers%ROWTYPE;
  supplier text;
  cost numeric := 0;
  discount numeric := 0;
  net numeric := 0;
BEGIN
  IF COALESCE(NEW.demo_stock_override, false) IS TRUE
     AND public.is_valid_demo_stock_override(
       NEW.order_id,
       NEW.product_name,
       COALESCE(NEW.variant_name, '')
     ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = NEW.order_id;
  IF o.seller_code_id IS NULL OR o.seller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO c
  FROM public.seller_codes
  WHERE id = o.seller_code_id AND tenant_id = o.tenant_id;
  SELECT * INTO s
  FROM public.sellers
  WHERE id = o.seller_id AND tenant_id = o.tenant_id;
  IF c.id IS NULL OR s.id IS NULL THEN
    RETURN NEW;
  END IF;

  supplier := o.supplier_id;
  IF supplier IS NOT NULL THEN
    SELECT COALESCE(spp.unit_price, 0)
    INTO cost
    FROM public.supplier_product_prices spp
    WHERE spp.supplier_id = supplier
      AND lower(trim(spp.product_name)) = lower(trim(NEW.product_name))
    LIMIT 1;
  END IF;

  discount := CASE
    WHEN COALESCE(o.total, 0) > 0
      THEN ROUND(COALESCE(o.discount_amount, 0) * ((NEW.product_price * NEW.quantity) / o.total), 2)
    ELSE 0
  END;
  net := GREATEST(0, NEW.product_price * NEW.quantity - discount);

  INSERT INTO public.seller_order_items (
    tenant_id,
    order_id,
    order_item_id,
    seller_id,
    seller_code_id,
    product_name,
    quantity,
    unit_price_before_discount,
    unit_price_after_discount,
    discount_amount,
    line_total,
    commission_percent,
    commission_amount,
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    payment_method,
    approved_at,
    supplier_id,
    supplier_cost,
    supplier_amount_due
  )
  VALUES (
    o.tenant_id,
    o.id,
    NEW.id,
    o.seller_id,
    o.seller_code_id,
    NEW.product_name,
    NEW.quantity,
    NEW.product_price,
    CASE WHEN NEW.quantity > 0 THEN net / NEW.quantity ELSE 0 END,
    discount,
    net,
    s.commission_percent,
    ROUND(net * s.commission_percent / 100, 2),
    o.customer_name,
    o.customer_phone,
    o.customer_email,
    o.customer_address,
    o.payment_method,
    CASE
      WHEN o.status IN ('received', 'preparing', 'ready-for-pickup', 'out-for-delivery', 'delivered')
        THEN COALESCE(o.updated_at, now())
      ELSE NULL
    END,
    supplier,
    cost,
    ROUND(cost * NEW.quantity, 2)
  )
  ON CONFLICT (order_id, seller_code_id, order_item_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.place_order(
  _order jsonb,
  _items jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order_id text;
  _payload jsonb;
  _columns text;
  _item jsonb;
  _product_name text;
  _variant_name text;
  _supplier_id text;
  _supplier_cost numeric;
  _fragments jsonb := '{}'::jsonb;
  _fragment_supplier_id text;
  _fragment_items jsonb;
  _item_with_supplier jsonb;
  _has_variants boolean;
  _demo_stock_override boolean := false;
  _demo_override_items jsonb := '[]'::jsonb;
  _supplier_ids jsonb := '[]'::jsonb;
  _order_supplier_id text;
BEGIN
  FOR _item IN
    SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb))
  LOOP
    _product_name := trim(COALESCE(
      _item->>'product_name',
      _item->'product'->>'name',
      ''
    ));
    _variant_name := trim(COALESCE(
      _item->>'variant_name',
      _item->>'variantName',
      _item->>'variant',
      ''
    ));

    IF _product_name = '' THEN
      RAISE EXCEPTION 'item_produto_obrigatorio';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      JOIN public.products p
        ON p.id = pv.product_id
       AND p.tenant_id = pv.tenant_id
      WHERE p.tenant_id = (_order->>'tenant_id')
        AND (
          NULLIF(_item->>'product_id', '') IS NULL
          OR p.id = _item->>'product_id'
        )
        AND public.catalog_product_match_key(p.name) =
            public.catalog_product_match_key(_product_name)
    ) INTO _has_variants;

    _supplier_id := NULL;
    _supplier_cost := NULL;
    _demo_stock_override := false;

    IF _has_variants AND _variant_name = '' THEN
      RAISE EXCEPTION 'variacao_obrigatoria: %', _product_name;
    END IF;

    IF _has_variants
       AND _variant_name <> ''
       AND COALESCE(_order->'metadata'->>'demo_payment', 'false') = 'true' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.product_variants pv
        JOIN public.products p
          ON p.id = pv.product_id
         AND p.tenant_id = pv.tenant_id
        JOIN public.tenants t ON t.id = p.tenant_id
        WHERE p.tenant_id = (_order->>'tenant_id')
          AND (
            (NULLIF(_item->>'product_id', '') IS NOT NULL
             AND p.id = _item->>'product_id')
            OR
            (NULLIF(_item->>'product_id', '') IS NULL
             AND public.catalog_product_match_key(p.name) =
                 public.catalog_product_match_key(_product_name))
          )
          AND (
            (NULLIF(_item->>'variant_id', '') IS NOT NULL
             AND pv.id = _item->>'variant_id')
            OR
            (NULLIF(_item->>'variant_id', '') IS NULL
             AND lower(trim(pv.name)) = lower(trim(_variant_name)))
          )
          AND lower(trim(pv.name)) = lower(trim(_variant_name))
          AND pv.demo_stock_override IS TRUE
          AND pv.in_stock::text = 'true'
          AND p.in_stock IS TRUE
          AND p.store_visible IS DISTINCT FROM false
          AND COALESCE(p.manual_blocked, false) IS FALSE
          AND t.demo_payment_enabled IS TRUE
      ) INTO _demo_stock_override;
    END IF;

    IF _has_variants THEN
      IF NOT _demo_stock_override THEN
        SELECT candidates.supplier_id, candidates.supplier_cost
        INTO _supplier_id, _supplier_cost
        FROM (
          SELECT
            o.supplier_id::text AS supplier_id,
            o.unit_cost AS supplier_cost,
            md5(o.supplier_id::text || ':' || o.product_variant_id::text) AS tie_key
          FROM public.supplier_variant_offers o
          JOIN public.supplier_catalog_snapshots cs
            ON cs.id = o.snapshot_id
           AND cs.supplier_id = o.supplier_id
           AND cs.tenant_id = o.tenant_id
           AND cs.status = 'completed'
          JOIN public.supplier_catalog_archives a
            ON a.id = o.source_archive_id
           AND a.expires_at > now()
          WHERE o.tenant_id::text = (_order->>'tenant_id')
            AND o.available = true
            AND o.unit_cost IS NOT NULL
            AND o.product_variant_id = (
              SELECT pv.id
              FROM public.product_variants pv
              JOIN public.products p
                ON p.id = pv.product_id
               AND p.tenant_id = pv.tenant_id
              WHERE p.tenant_id = (_order->>'tenant_id')
                AND (
                  NULLIF(_item->>'product_id', '') IS NULL
                  OR p.id = _item->>'product_id'
                )
                AND public.catalog_product_match_key(p.name) =
                    public.catalog_product_match_key(_product_name)
                AND (
                  NULLIF(_item->>'variant_id', '') IS NULL
                  OR pv.id = _item->>'variant_id'
                )
                AND lower(trim(pv.name)) = lower(trim(_variant_name))
                AND lower(pv.in_stock::text) = 'true'
              LIMIT 1
            )
        ) AS candidates
        ORDER BY candidates.supplier_cost, candidates.tie_key
        LIMIT 1;
      END IF;
    ELSE
      SELECT
        spp.supplier_id::text,
        spp.unit_price
      INTO _supplier_id, _supplier_cost
      FROM public.supplier_product_prices spp
      JOIN public.suppliers s
        ON s.id = spp.supplier_id
       AND s.tenant_id = (_order->>'tenant_id')
      JOIN public.supplier_catalog_snapshots cs
        ON cs.supplier_id = spp.supplier_id
       AND cs.archive_id = spp.source_archive_id
       AND cs.tenant_id = (_order->>'tenant_id')
       AND cs.status = 'completed'
      JOIN public.supplier_catalog_archives a
        ON a.id = spp.source_archive_id
       AND a.expires_at > now()
      WHERE spp.available = true
        AND spp.unit_price IS NOT NULL
        AND public.catalog_product_match_key(spp.product_name) =
            public.catalog_product_match_key(_product_name)
      ORDER BY spp.unit_price,
        md5(spp.supplier_id::text || ':' || _product_name)
      LIMIT 1;
    END IF;

    IF _supplier_id IS NULL AND NOT _demo_stock_override THEN
      RAISE EXCEPTION 'fornecedor_sem_estoque_atual: % / %',
        _product_name, _variant_name;
    END IF;

    IF _demo_stock_override THEN
      _demo_override_items := _demo_override_items || jsonb_build_array(
        jsonb_build_object(
          'product_id', NULLIF(_item->>'product_id', ''),
          'variant_id', NULLIF(_item->>'variant_id', ''),
          'product_name', _product_name,
          'variant_name', _variant_name
        )
      );
    ELSE
      _item_with_supplier := _item || jsonb_build_object(
        'supplier_id', _supplier_id,
        'supplier_cost', _supplier_cost
      );
      _fragment_items := COALESCE(_fragments->_supplier_id, '[]'::jsonb)
        || jsonb_build_array(_item_with_supplier);
      _fragments := jsonb_set(
        _fragments,
        ARRAY[_supplier_id],
        _fragment_items,
        true
      );
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
  INTO _supplier_ids
  FROM jsonb_object_keys(_fragments) AS keys(k);

  _order_supplier_id := _order->>'supplier_id';
  IF jsonb_array_length(_demo_override_items) > 0 THEN
    _order_supplier_id := NULL;
    IF jsonb_object_length(_fragments) = 1 THEN
      SELECT k
      INTO _order_supplier_id
      FROM jsonb_object_keys(_fragments) AS keys(k)
      LIMIT 1;
    END IF;
  END IF;

  _payload := (_order - 'id' - 'created_at' - 'updated_at')
    || jsonb_build_object(
      'supplier_id', _order_supplier_id,
      'metadata',
      COALESCE(_order->'metadata', '{}'::jsonb)
      || jsonb_build_object(
        'fragmentation_map', _fragments,
        'supplier_ids', _supplier_ids,
        'needs_fragmentation', jsonb_object_length(_fragments) > 1,
        'demo_stock_override_items', _demo_override_items
      )
    );

  SELECT string_agg(format('%I', key), ',')
  INTO _columns
  FROM jsonb_object_keys(_payload) AS key
  WHERE EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'orders'
      AND c.column_name = key
  );

  IF _columns IS NULL THEN
    RAISE EXCEPTION 'pedido_sem_colunas_validas';
  END IF;

  EXECUTE format(
    'INSERT INTO public.orders(%s) SELECT %s FROM jsonb_populate_record(null::public.orders, $1) RETURNING id',
    _columns,
    _columns
  ) USING _payload INTO _order_id;

  FOR _item IN
    SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb))
  LOOP
    _product_name := trim(COALESCE(
      _item->>'product_name',
      _item->'product'->>'name',
      ''
    ));
    _variant_name := trim(COALESCE(
      _item->>'variant_name',
      _item->>'variantName',
      _item->>'variant',
      ''
    ));
    _demo_stock_override := false;

    IF _variant_name <> ''
       AND COALESCE(_order->'metadata'->>'demo_payment', 'false') = 'true' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.product_variants pv
        JOIN public.products p
          ON p.id = pv.product_id
         AND p.tenant_id = pv.tenant_id
        JOIN public.tenants t ON t.id = p.tenant_id
        WHERE p.tenant_id = (_order->>'tenant_id')
          AND (
            (NULLIF(_item->>'product_id', '') IS NOT NULL
             AND p.id = _item->>'product_id')
            OR
            (NULLIF(_item->>'product_id', '') IS NULL
             AND public.catalog_product_match_key(p.name) =
                 public.catalog_product_match_key(_product_name))
          )
          AND (
            (NULLIF(_item->>'variant_id', '') IS NOT NULL
             AND pv.id = _item->>'variant_id')
            OR
            (NULLIF(_item->>'variant_id', '') IS NULL
             AND lower(trim(pv.name)) = lower(trim(_variant_name)))
          )
          AND lower(trim(pv.name)) = lower(trim(_variant_name))
          AND pv.demo_stock_override IS TRUE
          AND pv.in_stock::text = 'true'
          AND p.in_stock IS TRUE
          AND p.store_visible IS DISTINCT FROM false
          AND COALESCE(p.manual_blocked, false) IS FALSE
          AND t.demo_payment_enabled IS TRUE
      ) INTO _demo_stock_override;
    END IF;

    IF _demo_stock_override THEN
      _payload := (_item - 'id' - 'created_at' - 'supplier_id' - 'supplier_cost')
        || jsonb_build_object(
          'order_id', _order_id,
          'demo_stock_override', true
        );
    ELSE
      _payload := (_item - 'id' - 'created_at')
        || jsonb_build_object('order_id', _order_id);
    END IF;

    SELECT string_agg(format('%I', key), ',')
    INTO _columns
    FROM jsonb_object_keys(_payload) AS key
    WHERE EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'order_items'
        AND c.column_name = key
    );

    IF _columns IS NULL THEN
      RAISE EXCEPTION 'item_pedido_sem_colunas_validas';
    END IF;

    EXECUTE format(
      'INSERT INTO public.order_items(%s) SELECT %s FROM jsonb_populate_record(null::public.order_items, $1)',
      _columns,
      _columns
    ) USING _payload;
  END LOOP;

  FOR _fragment_supplier_id IN
    SELECT jsonb_object_keys(_fragments)
  LOOP
    _fragment_items := _fragments->_fragment_supplier_id;
    INSERT INTO public.order_fragments(
      order_id,
      tenant_id,
      supplier_id,
      items,
      total,
      status
    )
    VALUES (
      _order_id,
      _order->>'tenant_id',
      _fragment_supplier_id,
      _fragment_items,
      (
        SELECT SUM(
          COALESCE((fragment_item->>'supplier_cost')::numeric, 0)
          * COALESCE((fragment_item->>'quantity')::numeric, 0)
        )
        FROM jsonb_array_elements(_fragment_items) AS fragment_item
      ),
      COALESCE(_order->>'status', 'pending')
    );

    UPDATE public.order_items AS oi
    SET supplier_id = _fragment_supplier_id
    WHERE oi.order_id = _order_id
      AND COALESCE(oi.demo_stock_override, false) IS FALSE
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(_fragment_items) AS fragment_item
        WHERE COALESCE(fragment_item->>'product_name', fragment_item->'product'->>'name') = oi.product_name
          AND COALESCE(
            fragment_item->>'variant_name',
            fragment_item->>'variantName',
            fragment_item->>'variant',
            ''
          ) = COALESCE(oi.variant_name, '')
      );
  END LOOP;

  RETURN _order_id::uuid;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
