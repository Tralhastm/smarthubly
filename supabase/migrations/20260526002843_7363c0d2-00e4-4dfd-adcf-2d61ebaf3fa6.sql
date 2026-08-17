
-- =========================================================
-- ORDERS: remove cancel exploit + narrow recent window
-- =========================================================
DROP POLICY IF EXISTS "Anon can update order status" ON public.orders;
DROP POLICY IF EXISTS "Clients can read just-created orders" ON public.orders;

CREATE POLICY "Clients can read just-created orders"
  ON public.orders FOR SELECT TO anon, authenticated
  USING (created_at > (now() - interval '2 minutes'));

-- =========================================================
-- ORDER_ITEMS: drop overly-broad authenticated SELECT
-- =========================================================
DROP POLICY IF EXISTS "Admins can view order items" ON public.order_items;

CREATE POLICY "Tenant admins read own order items"
  ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (has_role(auth.uid(),'admin'::app_role,o.tenant_id)
        OR has_platform_role(auth.uid(),'super_admin'::platform_role))
  ));

-- =========================================================
-- PUSH SUBSCRIPTIONS: stricter delete guard
-- =========================================================
DROP POLICY IF EXISTS "Owner deletes by endpoint" ON public.push_subscriptions;
CREATE POLICY "Delete only with full endpoint"
  ON public.push_subscriptions FOR DELETE TO anon, authenticated
  USING (endpoint IS NOT NULL AND length(endpoint) >= 50);

-- =========================================================
-- ORDER_CHATS / MESSAGES: lock down, expose via token RPCs
-- =========================================================
DROP POLICY IF EXISTS "Anon can read own chat by token" ON public.order_chats;
DROP POLICY IF EXISTS "Anon can update unread counters" ON public.order_chats;
DROP POLICY IF EXISTS "Anyone can read messages" ON public.order_chat_messages;
DROP POLICY IF EXISTS "Anyone can insert message" ON public.order_chat_messages;

-- Admins read/update own tenant chats
CREATE POLICY "Admins read own tenant chats"
  ON public.order_chats FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role,tenant_id)
      OR has_platform_role(auth.uid(),'super_admin'::platform_role));

CREATE POLICY "Admins update own tenant chats"
  ON public.order_chats FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role,tenant_id)
      OR has_platform_role(auth.uid(),'super_admin'::platform_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role,tenant_id)
      OR has_platform_role(auth.uid(),'super_admin'::platform_role));

CREATE POLICY "Admins read own tenant messages"
  ON public.order_chat_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.order_chats c
    WHERE c.id = order_chat_messages.chat_id
      AND (has_role(auth.uid(),'admin'::app_role,c.tenant_id)
        OR has_platform_role(auth.uid(),'super_admin'::platform_role))
  ));

CREATE POLICY "Admins send store messages"
  ON public.order_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_type = 'store' AND EXISTS (
      SELECT 1 FROM public.order_chats c
      WHERE c.id = order_chat_messages.chat_id
        AND (has_role(auth.uid(),'admin'::app_role,c.tenant_id)
          OR has_platform_role(auth.uid(),'super_admin'::platform_role))
    )
  );

-- RPCs for customer-side chat access (token-scoped)
CREATE OR REPLACE FUNCTION public.get_order_chat_by_token(_chat_id uuid, _token text)
RETURNS SETOF public.order_chats
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.order_chats
   WHERE id = _chat_id AND customer_session_token = _token
     AND _token IS NOT NULL AND length(_token) >= 16
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.find_or_create_order_chat(
  _order_id uuid, _tenant_id uuid, _customer_name text, _customer_phone text
) RETURNS public.order_chats
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_chat public.order_chats; v_order_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_order_tenant FROM public.orders WHERE id = _order_id;
  IF v_order_tenant IS NULL OR v_order_tenant <> _tenant_id THEN
    RAISE EXCEPTION 'invalid_order';
  END IF;
  SELECT * INTO v_chat FROM public.order_chats WHERE order_id = _order_id LIMIT 1;
  IF v_chat.id IS NOT NULL THEN RETURN v_chat; END IF;
  INSERT INTO public.order_chats (order_id, tenant_id, customer_name, customer_phone)
    VALUES (_order_id, _tenant_id, COALESCE(_customer_name,''), COALESCE(_customer_phone,''))
  RETURNING * INTO v_chat;
  RETURN v_chat;
END; $$;

CREATE OR REPLACE FUNCTION public.list_chat_messages_by_token(_chat_id uuid, _token text)
RETURNS SETOF public.order_chat_messages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.* FROM public.order_chat_messages m
  WHERE m.chat_id = _chat_id
    AND EXISTS (
      SELECT 1 FROM public.order_chats c
      WHERE c.id = _chat_id AND c.customer_session_token = _token
        AND _token IS NOT NULL AND length(_token) >= 16
    )
  ORDER BY m.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.send_customer_chat_message(_chat_id uuid, _token text, _content text)
RETURNS public.order_chat_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_msg public.order_chat_messages;
BEGIN
  IF _content IS NULL OR length(trim(_content)) = 0 THEN RAISE EXCEPTION 'empty_message'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_chats
    WHERE id = _chat_id AND customer_session_token = _token
      AND _token IS NOT NULL AND length(_token) >= 16
  ) THEN RAISE EXCEPTION 'invalid_token'; END IF;
  INSERT INTO public.order_chat_messages (chat_id, sender_type, content)
    VALUES (_chat_id, 'customer', left(trim(_content), 2000))
  RETURNING * INTO v_msg;
  RETURN v_msg;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_chat_read_by_token(_chat_id uuid, _token text, _side text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.order_chats
    WHERE id = _chat_id AND customer_session_token = _token
      AND _token IS NOT NULL AND length(_token) >= 16
  ) THEN RETURN; END IF;
  IF _side = 'customer' THEN
    UPDATE public.order_chats SET unread_for_customer = 0 WHERE id = _chat_id;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_order_chat_by_token(uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_order_chat(uuid,uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_chat_messages_by_token(uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_customer_chat_message(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_chat_read_by_token(uuid,text,text) TO anon, authenticated;

-- =========================================================
-- ORDER_EVENTS: insert must match order tenant
-- =========================================================
DROP POLICY IF EXISTS "Anyone can insert order events for existing orders" ON public.order_events;
CREATE POLICY "Insert order events for matching tenant"
  ON public.order_events FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_events.order_id AND o.tenant_id = order_events.tenant_id
  ));

-- =========================================================
-- Revoke EXECUTE on sensitive internal functions
-- =========================================================
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.log_platform_fee_entry(uuid) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.log_order_revenue_entry(uuid) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.mark_overdue_credits() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.enqueue_email(text,jsonb) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.delete_email(text,bigint) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text,text,bigint,jsonb) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.read_email_batch(text,integer,integer) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.detect_ghost_orders() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.auto_cancel_expired_orders() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.cleanup_stale_drivers() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.request_admin_role(uuid,uuid,text) FROM anon, authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
