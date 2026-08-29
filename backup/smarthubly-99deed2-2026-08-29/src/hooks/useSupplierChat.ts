import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type SupplierChat = {
  id: string;
  tenant_id: string;
  supplier_id: string;
  product_id: string;
  customer_name: string;
  customer_session_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  sender_type: 'customer' | 'supplier';
  content: string;
  original_content: string | null;
  is_filtered: boolean;
  created_at: string;
};

// Regex patterns to detect contact info (anti-poaching)
const CONTACT_PATTERNS = [
  // Phone numbers (Brazilian format)
  /\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4}/g,
  /\d{10,11}/g,
  // Email
  /[\w.-]+@[\w.-]+\.\w{2,}/gi,
  // Instagram/social
  /@[\w.]{3,}/g,
  // WhatsApp mentions
  /whats?\s*app/gi,
  /zap/gi,
  // URLs
  /https?:\/\/[^\s]+/gi,
  /www\.[^\s]+/gi,
  // "me liga", "me chama", explicit contact attempts
  /me\s+(liga|chama|add|adiciona)/gi,
  /meu\s+(número|numero|telefone|cel|celular|contato|insta|instagram|face|facebook|email|e-mail|zap|whatsapp)/gi,
  /passa\s+(teu|seu|o)\s*(número|numero|telefone|cel|celular|contato|insta|instagram|zap|whatsapp)/gi,
];

export function filterContactInfo(text: string): { filtered: string; wasFiltered: boolean } {
  let result = text;
  let wasFiltered = false;

  for (const pattern of CONTACT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(result)) {
      wasFiltered = true;
      result = result.replace(new RegExp(pattern.source, pattern.flags), '[conteúdo bloqueado]');
    }
  }

  return { filtered: result, wasFiltered };
}

const SESSION_KEY = 'supplier_chat_sessions';

function getSessionTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
  } catch { return {}; }
}

function saveSessionToken(chatId: string, token: string) {
  const tokens = getSessionTokens();
  tokens[chatId] = token;
  localStorage.setItem(SESSION_KEY, JSON.stringify(tokens));
}

export function getSessionToken(chatId: string): string | null {
  return getSessionTokens()[chatId] || null;
}

// Customer: start or resume chat with a supplier about a product
export function useCustomerChat(tenantId: string, productId: string, supplierId: string) {
  const [chat, setChat] = useState<SupplierChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const initChat = useCallback(async (customerName: string) => {
    setLoading(true);
    try {
      // Check if there's an existing chat for this product+session
      const tokens = getSessionTokens();
      const existingKey = Object.keys(tokens).find(k => k.startsWith(`${productId}_`));
      
      if (existingKey) {
        const token = tokens[existingKey];
        const { data: rows } = await (supabase as any).rpc('get_supplier_chat_by_token', { _token: token, _product_id: productId });
        const data = Array.isArray(rows) ? rows[0] : rows;
        if (data) {
          setChat(data as SupplierChat);
          await fetchMessages(data.id);
          setLoading(false);
          return;
        }
      }

      // Create new chat
      const { data, error } = await (supabase as any).rpc('create_customer_supplier_chat', {
        _tenant_id: tenantId,
        _supplier_id: supplierId,
        _product_id: productId,
        _customer_name: customerName,
      });
      if (error) throw error;
      const newChat = data as SupplierChat;
      saveSessionToken(`${productId}_${newChat.id}`, newChat.customer_session_token);
      setChat(newChat);
      setMessages([]);
    } catch (e) {
      console.error('Error initializing chat:', e);
    }
    setLoading(false);
  }, [tenantId, productId, supplierId]);

  const fetchMessages = async (chatId: string) => {
    const { data } = await supabase.from('supplier_chat_messages')
      .select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
    setMessages((data as ChatMessage[]) || []);
  };

  const sendMessage = useCallback(async (content: string) => {
    if (!chat) return;
    const { filtered, wasFiltered } = filterContactInfo(content);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Optimistic update
    const optimisticMsg: ChatMessage = {
      id: tempId,
      chat_id: chat.id,
      sender_type: 'customer',
      content: filtered,
      original_content: wasFiltered ? content : null,
      is_filtered: wasFiltered,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const { data, error } = await supabase.from('supplier_chat_messages').insert({
      chat_id: chat.id,
      sender_type: 'customer',
      content: filtered,
      original_content: wasFiltered ? content : null,
      is_filtered: wasFiltered,
    }).select().single();

    if (error) {
      // Roll back optimistic on failure
      setMessages(prev => prev.filter(m => m.id !== tempId));
      return;
    }

    // Replace optimistic with real message (so realtime echo dedupes properly)
    if (data) {
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempId);
        if (withoutTemp.some(m => m.id === (data as ChatMessage).id)) return withoutTemp;
        return [...withoutTemp, data as ChatMessage];
      });
    }
  }, [chat]);

  // Realtime subscription
  useEffect(() => {
    if (!chat) return;
    fetchMessages(chat.id);
    const channel = supabase
      .channel(`chat-${chat.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'supplier_chat_messages', filter: `chat_id=eq.${chat.id}` },
        (payload) => {
          setMessages(prev => {
            if (prev.some(m => m.id === (payload.new as ChatMessage).id)) return prev;
            return [...prev, payload.new as ChatMessage];
          });
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chat?.id]);

  return { chat, messages, loading, initChat, sendMessage };
}

// Supplier: list all chats and respond
export function useSupplierChats(supplierToken: string) {
  const [chats, setChats] = useState<(SupplierChat & { product_name?: string; unread?: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChats = useCallback(async () => {
    if (!supplierToken) return;
    const { data } = await (supabase as any).rpc('list_supplier_chats_by_supplier_token', { _token: supplierToken });

    if (!data) { setChats([]); setLoading(false); return; }

    // Get product names
    const productIds = [...new Set((data as SupplierChat[]).map(c => c.product_id))];
    const { data: products } = await supabase.from('products')
      .select('id, name').in('id', productIds);
    const productMap = new Map((products || []).map(p => [p.id, p.name]));

    setChats((data as SupplierChat[]).map(c => ({
      ...c,
      product_name: productMap.get(c.product_id) || 'Produto',
    })));
    setLoading(false);
  }, [supplierToken]);

  useEffect(() => {
    fetchChats();
    const interval = setInterval(fetchChats, 10000);
    return () => clearInterval(interval);
  }, [fetchChats]);

  return { chats, loading, refetch: fetchChats };
}

export function useSupplierChatMessages(chatId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const fetchMessages = useCallback(async () => {
    if (!chatId) return;
    const { data } = await supabase.from('supplier_chat_messages')
      .select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
    setMessages((data as ChatMessage[]) || []);
  }, [chatId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!chatId) return;
    const { filtered, wasFiltered } = filterContactInfo(content);
    await supabase.from('supplier_chat_messages').insert({
      chat_id: chatId,
      sender_type: 'supplier',
      content: filtered,
      original_content: wasFiltered ? content : null,
      is_filtered: wasFiltered,
    });
  }, [chatId]);

  useEffect(() => {
    if (!chatId) { setMessages([]); return; }
    fetchMessages();
    const channel = supabase
      .channel(`supplier-chat-${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'supplier_chat_messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          setMessages(prev => {
            if (prev.some(m => m.id === (payload.new as ChatMessage).id)) return prev;
            return [...prev, payload.new as ChatMessage];
          });
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId]);

  return { messages, sendMessage };
}
