
-- ============ ORDERS ============
DROP POLICY IF EXISTS "Clients can read just-created orders" ON public.orders;

-- ============ ORDER_ITEMS ============
DROP POLICY IF EXISTS "Anon can read order items" ON public.order_items;

CREATE OR REPLACE FUNCTION public.get_order_items_public(_order_id uuid)
RETURNS SETOF public.order_items
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT oi.* FROM public.order_items oi
  WHERE oi.order_id = _order_id
    AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = _order_id);
$$;

-- ============ LOYALTY_RECORDS ============
DROP POLICY IF EXISTS "Anyone can read loyalty" ON public.loyalty_records;
DROP POLICY IF EXISTS "Anyone can insert loyalty" ON public.loyalty_records;

CREATE POLICY "Admins read loyalty" ON public.loyalty_records
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role, tenant_id)
  OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
);

CREATE POLICY "Admins insert loyalty" ON public.loyalty_records
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role, tenant_id)
  OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
);

CREATE OR REPLACE FUNCTION public.register_loyalty_point(_tenant_id uuid, _address text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_addr text; v_existing record; v_points int;
BEGIN
  IF _tenant_id IS NULL OR _address IS NULL OR length(trim(_address)) < 3 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  v_addr := lower(trim(_address));
  SELECT id, points INTO v_existing FROM public.loyalty_records
   WHERE tenant_id = _tenant_id AND address = v_addr LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.loyalty_records SET points = v_existing.points + 1 WHERE id = v_existing.id;
    RETURN v_existing.points + 1;
  ELSE
    INSERT INTO public.loyalty_records (tenant_id, address, points) VALUES (_tenant_id, v_addr, 1);
    RETURN 1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_loyalty_points(_tenant_id uuid, _address text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT points FROM public.loyalty_records
    WHERE tenant_id = _tenant_id AND address = lower(trim(_address)) LIMIT 1), 0);
$$;

-- ============ SERVICE_REQUESTS ============
DROP POLICY IF EXISTS "Anyone can read service requests" ON public.service_requests;
DROP POLICY IF EXISTS "Anyone can update service requests" ON public.service_requests;

CREATE POLICY "Admins read service requests" ON public.service_requests
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role, tenant_id)
  OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
);

CREATE POLICY "Admins update service requests" ON public.service_requests
FOR UPDATE USING (
  has_role(auth.uid(), 'admin'::app_role, tenant_id)
  OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
);

CREATE OR REPLACE FUNCTION public.list_service_requests_for_session(_session_id uuid)
RETURNS SETOF public.service_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.service_requests
   WHERE session_id = _session_id AND status = 'open'
   ORDER BY created_at DESC;
$$;

-- ============ SUPPLIER_CHATS ============
DROP POLICY IF EXISTS "Anyone can read chats" ON public.supplier_chats;
DROP POLICY IF EXISTS "Anyone can insert chats" ON public.supplier_chats;
DROP POLICY IF EXISTS "Suppliers update own chats by id" ON public.supplier_chats;

CREATE POLICY "Admins read supplier chats" ON public.supplier_chats
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role, tenant_id)
  OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
);

CREATE POLICY "Admins update supplier chats" ON public.supplier_chats
FOR UPDATE USING (
  has_role(auth.uid(), 'admin'::app_role, tenant_id)
  OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
);

CREATE OR REPLACE FUNCTION public.create_customer_supplier_chat(
  _tenant_id uuid, _supplier_id uuid, _product_id uuid, _customer_name text
) RETURNS public.supplier_chats
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_chat public.supplier_chats;
BEGIN
  IF _tenant_id IS NULL OR _supplier_id IS NULL OR _product_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  INSERT INTO public.supplier_chats (tenant_id, supplier_id, product_id, customer_name)
    VALUES (_tenant_id, _supplier_id, _product_id, COALESCE(_customer_name,''))
  RETURNING * INTO v_chat;
  RETURN v_chat;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_supplier_chat_by_token(_token text, _product_id uuid)
RETURNS SETOF public.supplier_chats
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.supplier_chats
   WHERE customer_session_token = _token AND product_id = _product_id
     AND _token IS NOT NULL AND length(_token) >= 16
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.list_supplier_chats_by_supplier_token(_token text)
RETURNS SETOF public.supplier_chats
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT sc.* FROM public.supplier_chats sc
  JOIN public.suppliers s ON s.id = sc.supplier_id
  WHERE s.access_token = _token AND _token IS NOT NULL AND length(_token) >= 16
    AND sc.is_active = true
  ORDER BY sc.updated_at DESC;
$$;

-- ============ ORDER_EVENTS ============
DROP POLICY IF EXISTS "Insert order events for matching tenant" ON public.order_events;

CREATE POLICY "Admins insert order events" ON public.order_events
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role, tenant_id)
  OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
);

CREATE OR REPLACE FUNCTION public.log_order_created_event(
  _order_id uuid, _description text, _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_order record;
BEGIN
  SELECT id, tenant_id, status, created_at INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.created_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'order_too_old';
  END IF;
  INSERT INTO public.order_events (order_id, tenant_id, event_type, actor, description, metadata, to_status)
  VALUES (_order_id, v_order.tenant_id, 'created', 'customer', COALESCE(_description,'Pedido criado'), COALESCE(_metadata,'{}'::jsonb), v_order.status);
END;
$$;

-- ============ PUSH_SUBSCRIPTIONS ============
DROP POLICY IF EXISTS "Delete only with full endpoint" ON public.push_subscriptions;

CREATE POLICY "Admins delete push subscriptions" ON public.push_subscriptions
FOR DELETE USING (
  (tenant_id IS NOT NULL AND (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  ))
);

CREATE OR REPLACE FUNCTION public.cleanup_push_subscription(
  _endpoint text,
  _driver_id uuid DEFAULT NULL,
  _supplier_id uuid DEFAULT NULL,
  _tenant_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count int := 0;
BEGIN
  IF _endpoint IS NULL OR length(_endpoint) < 50 THEN RETURN 0; END IF;
  IF _driver_id IS NULL AND _supplier_id IS NULL AND _tenant_id IS NULL THEN
    RAISE EXCEPTION 'owner_required';
  END IF;
  DELETE FROM public.push_subscriptions
   WHERE endpoint = _endpoint
     AND (
       (_driver_id IS NOT NULL AND driver_id = _driver_id)
       OR (_supplier_id IS NOT NULL AND supplier_id = _supplier_id)
       OR (_tenant_id IS NOT NULL AND tenant_id = _tenant_id)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
