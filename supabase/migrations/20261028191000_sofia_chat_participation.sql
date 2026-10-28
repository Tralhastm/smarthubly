-- A Sofia passa a ser participante explícita dos chats, sem confundir sua mensagem com a da loja.
ALTER TABLE public.store_support_messages DROP CONSTRAINT IF EXISTS store_support_messages_sender_type_check;
ALTER TABLE public.store_support_messages ADD CONSTRAINT store_support_messages_sender_type_check CHECK (sender_type IN ('customer', 'store', 'sofia'));
ALTER TABLE public.order_chat_messages DROP CONSTRAINT IF EXISTS order_chat_messages_sender_type_check;
ALTER TABLE public.order_chat_messages ADD CONSTRAINT order_chat_messages_sender_type_check CHECK (sender_type IN ('customer', 'store', 'sofia'));

CREATE OR REPLACE FUNCTION public.send_store_support_sofia_message(_chat_id UUID, _session_token TEXT, _content TEXT)
RETURNS public.store_support_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_message public.store_support_messages;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_support_chats WHERE id = _chat_id AND customer_session_token = _session_token) THEN RAISE EXCEPTION 'support_access_denied'; END IF;
  IF trim(COALESCE(_content, '')) = '' THEN RAISE EXCEPTION 'empty_support_message'; END IF;
  INSERT INTO public.store_support_messages (chat_id, sender_type, content) VALUES (_chat_id, 'sofia', left(trim(_content), 4000)) RETURNING * INTO v_message;
  RETURN v_message;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_store_support_sofia_message(UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_sofia_order_chat_message(_chat_id UUID, _token TEXT, _content TEXT)
RETURNS public.order_chat_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_message public.order_chat_messages;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.order_chats WHERE id = _chat_id AND customer_session_token = _token AND _token IS NOT NULL AND length(_token) >= 16) THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF trim(COALESCE(_content, '')) = '' THEN RAISE EXCEPTION 'empty_message'; END IF;
  INSERT INTO public.order_chat_messages (chat_id, sender_type, content) VALUES (_chat_id, 'sofia', left(trim(_content), 4000)) RETURNING * INTO v_message;
  RETURN v_message;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_sofia_order_chat_message(UUID, TEXT, TEXT) TO anon, authenticated;

-- Mensagens da Sofia não geram alerta de atendimento humano para a loja.
CREATE OR REPLACE FUNCTION public.trg_store_support_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.store_support_chats
  SET last_message_at = NEW.created_at, last_sender = NEW.sender_type,
      unread_for_store = CASE WHEN NEW.sender_type = 'customer' THEN unread_for_store + 1 ELSE unread_for_store END,
      unread_for_customer = CASE WHEN NEW.sender_type = 'store' OR NEW.sender_type = 'sofia' THEN unread_for_customer + 1 ELSE unread_for_customer END,
      updated_at = now()
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.trg_order_chat_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_chat record;
BEGIN
  SELECT * INTO v_chat FROM public.order_chats WHERE id = NEW.chat_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.sender_type = 'customer' THEN
    UPDATE public.order_chats SET last_message_at = NEW.created_at, last_sender = 'customer', unread_for_store = unread_for_store + 1, updated_at = now() WHERE id = NEW.chat_id;
  ELSIF NEW.sender_type IN ('store', 'sofia') THEN
    UPDATE public.order_chats SET last_message_at = NEW.created_at, last_sender = NEW.sender_type, unread_for_customer = unread_for_customer + 1, updated_at = now() WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$$;
