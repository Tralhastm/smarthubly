-- Chat geral de suporte entre cliente e loja, independente de pedido ou fornecedor.
CREATE TABLE IF NOT EXISTS public.store_support_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_session_token TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  last_message_at TIMESTAMPTZ,
  last_sender TEXT,
  unread_for_store INTEGER NOT NULL DEFAULT 0,
  unread_for_customer INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_session_token)
);

CREATE TABLE IF NOT EXISTS public.store_support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.store_support_chats(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'store')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_support_chats_tenant ON public.store_support_chats(tenant_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_store_support_messages_chat ON public.store_support_messages(chat_id, created_at);

ALTER TABLE public.store_support_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Store admins read support chats" ON public.store_support_chats;
CREATE POLICY "Store admins read support chats" ON public.store_support_chats FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid) OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Store admins update support chats" ON public.store_support_chats;
CREATE POLICY "Store admins update support chats" ON public.store_support_chats FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid) OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role));
DROP POLICY IF EXISTS "Store admins read support messages" ON public.store_support_messages;
CREATE POLICY "Store admins read support messages" ON public.store_support_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.store_support_chats c WHERE c.id = chat_id AND (public.has_role(auth.uid(), 'admin'::app_role, c.tenant_id::uuid) OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role))));
DROP POLICY IF EXISTS "Store admins send support messages" ON public.store_support_messages;
CREATE POLICY "Store admins send support messages" ON public.store_support_messages FOR INSERT TO authenticated
  WITH CHECK (sender_type = 'store' AND EXISTS (SELECT 1 FROM public.store_support_chats c WHERE c.id = chat_id AND (public.has_role(auth.uid(), 'admin'::app_role, c.tenant_id::uuid) OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role))));

CREATE OR REPLACE FUNCTION public.find_or_create_store_support_chat(
  _tenant_id TEXT, _session_token TEXT, _customer_name TEXT DEFAULT '', _customer_phone TEXT DEFAULT ''
) RETURNS public.store_support_chats
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_chat public.store_support_chats;
BEGIN
  IF _tenant_id IS NULL OR COALESCE(trim(_session_token), '') = '' THEN RAISE EXCEPTION 'invalid_support_session'; END IF;
  SELECT * INTO v_chat FROM public.store_support_chats WHERE tenant_id = _tenant_id AND customer_session_token = _session_token FOR UPDATE;
  IF FOUND THEN RETURN v_chat; END IF;
  INSERT INTO public.store_support_chats (tenant_id, customer_session_token, customer_name, customer_phone)
  VALUES (_tenant_id, _session_token, COALESCE(trim(_customer_name), ''), COALESCE(trim(_customer_phone), ''))
  RETURNING * INTO v_chat;
  RETURN v_chat;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_store_support_messages(_chat_id UUID, _session_token TEXT)
RETURNS SETOF public.store_support_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_support_chats WHERE id = _chat_id AND customer_session_token = _session_token) THEN RAISE EXCEPTION 'support_access_denied'; END IF;
  RETURN QUERY SELECT * FROM public.store_support_messages WHERE chat_id = _chat_id ORDER BY created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_store_support_message(_chat_id UUID, _session_token TEXT, _content TEXT)
RETURNS public.store_support_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_message public.store_support_messages;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_support_chats WHERE id = _chat_id AND customer_session_token = _session_token) THEN RAISE EXCEPTION 'support_access_denied'; END IF;
  IF trim(COALESCE(_content, '')) = '' THEN RAISE EXCEPTION 'empty_support_message'; END IF;
  INSERT INTO public.store_support_messages (chat_id, sender_type, content) VALUES (_chat_id, 'customer', trim(_content)) RETURNING * INTO v_message;
  RETURN v_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_store_support_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.store_support_chats
  SET last_message_at = NEW.created_at, last_sender = NEW.sender_type,
      unread_for_store = CASE WHEN NEW.sender_type = 'customer' THEN unread_for_store + 1 ELSE unread_for_store END,
      unread_for_customer = CASE WHEN NEW.sender_type = 'store' THEN unread_for_customer + 1 ELSE unread_for_customer END,
      updated_at = now()
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_store_support_message ON public.store_support_messages;
CREATE TRIGGER on_store_support_message AFTER INSERT ON public.store_support_messages FOR EACH ROW EXECUTE FUNCTION public.trg_store_support_on_message();

ALTER PUBLICATION supabase_realtime ADD TABLE public.store_support_chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_support_messages;
REVOKE ALL ON FUNCTION public.find_or_create_store_support_chat(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_or_create_store_support_chat(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.list_store_support_messages(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_store_support_messages(UUID, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.send_store_support_message(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_store_support_message(UUID, TEXT, TEXT) TO anon, authenticated;
