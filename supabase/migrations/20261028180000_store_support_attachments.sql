-- Anexos das mensagens do Suporte direto.
ALTER TABLE public.store_support_messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size INTEGER;

INSERT INTO storage.buckets (id, name, public)
VALUES ('store-support-attachments', 'store-support-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Anyone can view store support attachments" ON storage.objects;
CREATE POLICY "Anyone can view store support attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'store-support-attachments');
DROP POLICY IF EXISTS "Anyone can upload store support attachments" ON storage.objects;
CREATE POLICY "Anyone can upload store support attachments"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'store-support-attachments');

CREATE OR REPLACE FUNCTION public.send_store_support_message(
  _chat_id UUID, _session_token TEXT, _content TEXT DEFAULT '',
  _attachment_url TEXT DEFAULT NULL, _attachment_name TEXT DEFAULT NULL,
  _attachment_type TEXT DEFAULT NULL, _attachment_size INTEGER DEFAULT NULL
)
RETURNS public.store_support_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_message public.store_support_messages;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_support_chats WHERE id = _chat_id AND customer_session_token = _session_token) THEN RAISE EXCEPTION 'support_access_denied'; END IF;
  IF trim(COALESCE(_content, '')) = '' AND COALESCE(trim(_attachment_url), '') = '' THEN RAISE EXCEPTION 'empty_support_message'; END IF;
  IF _attachment_size IS NOT NULL AND (_attachment_size <= 0 OR _attachment_size > 10485760) THEN RAISE EXCEPTION 'invalid_attachment_size'; END IF;
  INSERT INTO public.store_support_messages (chat_id, sender_type, content, attachment_url, attachment_name, attachment_type, attachment_size)
  VALUES (_chat_id, 'customer', trim(COALESCE(_content, '')), NULLIF(trim(_attachment_url), ''), NULLIF(trim(_attachment_name), ''), NULLIF(trim(_attachment_type), ''), _attachment_size)
  RETURNING * INTO v_message;
  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.send_store_support_message(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_store_support_message(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO anon, authenticated;
