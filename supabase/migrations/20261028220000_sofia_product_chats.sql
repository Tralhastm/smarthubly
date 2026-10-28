ALTER TABLE public.supplier_chat_messages DROP CONSTRAINT IF EXISTS supplier_chat_messages_sender_type_check;
ALTER TABLE public.supplier_chat_messages ADD CONSTRAINT supplier_chat_messages_sender_type_check CHECK (sender_type IN ('customer', 'supplier', 'sofia'));
CREATE OR REPLACE FUNCTION public.send_sofia_supplier_chat_message(_chat_id UUID, _token TEXT, _content TEXT)
RETURNS public.supplier_chat_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_message public.supplier_chat_messages;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.supplier_chats WHERE id = _chat_id AND customer_session_token = _token AND _token IS NOT NULL AND length(_token) >= 16) THEN RAISE EXCEPTION 'invalid_supplier_chat_token'; END IF;
  IF trim(COALESCE(_content, '')) = '' THEN RAISE EXCEPTION 'empty_message'; END IF;
  INSERT INTO public.supplier_chat_messages (chat_id, sender_type, content, is_filtered) VALUES (_chat_id, 'sofia', left(trim(_content), 4000), false) RETURNING * INTO v_message;
  RETURN v_message;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_sofia_supplier_chat_message(UUID, TEXT, TEXT) TO anon, authenticated;
