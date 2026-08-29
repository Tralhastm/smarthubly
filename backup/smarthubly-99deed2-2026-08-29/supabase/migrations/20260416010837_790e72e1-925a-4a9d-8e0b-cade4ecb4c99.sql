
-- Chat conversations between customers and suppliers (dropshipping only)
CREATE TABLE public.supplier_chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_session_token TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Chat messages
CREATE TABLE public.supplier_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES public.supplier_chats(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'supplier')),
  content TEXT NOT NULL,
  original_content TEXT, -- stores original if filtered
  is_filtered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.supplier_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_chat_messages ENABLE ROW LEVEL SECURITY;

-- Public access policies (access controlled by session tokens)
CREATE POLICY "Anyone can read chats" ON public.supplier_chats FOR SELECT USING (true);
CREATE POLICY "Anyone can insert chats" ON public.supplier_chats FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update chats" ON public.supplier_chats FOR UPDATE USING (true);

CREATE POLICY "Anyone can read messages" ON public.supplier_chat_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can insert messages" ON public.supplier_chat_messages FOR INSERT WITH CHECK (true);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.supplier_chat_messages;

-- Index for performance
CREATE INDEX idx_supplier_chat_messages_chat_id ON public.supplier_chat_messages(chat_id);
CREATE INDEX idx_supplier_chats_supplier_id ON public.supplier_chats(supplier_id);
CREATE INDEX idx_supplier_chats_session_token ON public.supplier_chats(customer_session_token);
