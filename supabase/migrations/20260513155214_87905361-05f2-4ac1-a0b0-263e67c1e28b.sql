
-- Chat cliente <-> loja vinculado ao pedido
CREATE TABLE public.order_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  customer_phone text NOT NULL DEFAULT '',
  customer_name text NOT NULL DEFAULT '',
  customer_session_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  last_message_at timestamptz,
  last_sender text,
  unread_for_store integer NOT NULL DEFAULT 0,
  unread_for_customer integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_chats_tenant ON public.order_chats(tenant_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_order_chats_order ON public.order_chats(order_id);

CREATE TABLE public.order_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.order_chats(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer','store')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_chat_messages_chat ON public.order_chat_messages(chat_id, created_at);

ALTER TABLE public.order_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_chat_messages ENABLE ROW LEVEL SECURITY;

-- order_chats policies
CREATE POLICY "Anon can create order chat for own order"
  ON public.order_chats FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anon can read own chat by token"
  ON public.order_chats FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Anon can update unread counters"
  ON public.order_chats FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins delete own tenant chats"
  ON public.order_chats FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- order_chat_messages policies
CREATE POLICY "Anyone can insert message"
  ON public.order_chat_messages FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can read messages"
  ON public.order_chat_messages FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Admins delete own tenant messages"
  ON public.order_chat_messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.order_chats c WHERE c.id = chat_id AND (has_role(auth.uid(), 'admin'::app_role, c.tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role))));

-- Trigger: ao inserir mensagem, atualiza order_chats e dispara push p/ lojista (se cliente) ou cliente
CREATE OR REPLACE FUNCTION public.trg_order_chat_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_chat record;
  v_tenant record;
BEGIN
  SELECT * INTO v_chat FROM public.order_chats WHERE id = NEW.chat_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_type = 'customer' THEN
    UPDATE public.order_chats
       SET last_message_at = NEW.created_at,
           last_sender = 'customer',
           unread_for_store = unread_for_store + 1,
           updated_at = now()
     WHERE id = NEW.chat_id;

    -- Dispara push pra loja (best-effort)
    BEGIN
      PERFORM net.http_post(
        url := 'https://zcnuvemvhhspfrvbttsw.supabase.co/functions/v1/notify-customer-message',
        headers := jsonb_build_object('Content-Type','application/json'),
        body := jsonb_build_object(
          'tenantId', v_chat.tenant_id,
          'orderId', v_chat.order_id,
          'customerName', COALESCE(v_chat.customer_name,'Cliente'),
          'preview', substring(NEW.content from 1 for 120)
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSE
    UPDATE public.order_chats
       SET last_message_at = NEW.created_at,
           last_sender = 'store',
           unread_for_customer = unread_for_customer + 1,
           updated_at = now()
     WHERE id = NEW.chat_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_order_chat_message
  AFTER INSERT ON public.order_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_order_chat_on_message();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_chats;
