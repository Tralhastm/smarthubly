import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type OrderChat = {
  id: string;
  order_id: string;
  tenant_id: string;
  customer_phone: string;
  customer_name: string;
  customer_session_token: string;
  last_message_at: string | null;
  last_sender: string | null;
  unread_for_store: number;
  unread_for_customer: number;
  created_at: string;
  updated_at: string;
};

export type OrderChatMessage = {
  id: string;
  chat_id: string;
  sender_type: 'customer' | 'store';
  content: string;
  created_at: string;
};

const SESSION_KEY = 'order_chat_tokens';

function getTokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; }
}
function saveToken(orderId: string, token: string) {
  const t = getTokens(); t[orderId] = token; localStorage.setItem(SESSION_KEY, JSON.stringify(t));
}

// CUSTOMER side: open chat for a specific order
export function useCustomerOrderChat(order: { id: string; tenant_id: string; customer_name?: string | null; customer_phone?: string | null } | null) {
  const [chat, setChat] = useState<OrderChat | null>(null);
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const ensureChat = useCallback(async () => {
    if (!order) return null;
    const { data, error } = await (supabase as any).rpc('find_or_create_order_chat', {
      _order_id: order.id,
      _tenant_id: order.tenant_id,
      _customer_name: order.customer_name || '',
      _customer_phone: order.customer_phone || '',
    });
    if (error || !data) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    saveToken(order.id, row.customer_session_token);
    setChat(row);
    return row;
  }, [order?.id]);

  const fetchMessages = useCallback(async (chatId: string, tokenOverride?: string) => {
    const token = tokenOverride || getTokens()[order?.id || ''] || '';
    if (!token) return;
    const { data } = await (supabase as any).rpc('list_chat_messages_by_token', { _chat_id: chatId, _token: token });
    setMessages((data as any) || []);
  }, [order?.id]);

  const sendMessage = useCallback(async (content: string) => {
    let c = chat;
    if (!c) c = await ensureChat();
    if (!c) return;
    const trimmed = content.trim(); if (!trimmed) return;
    const token = getTokens()[order?.id || ''] || c.customer_session_token;
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, chat_id: c!.id, sender_type: 'customer', content: trimmed, created_at: new Date().toISOString() }]);
    const { data, error } = await (supabase as any).rpc('send_customer_chat_message', { _chat_id: c.id, _token: token, _content: trimmed });
    if (error) { setMessages(prev => prev.filter(m => m.id !== tempId)); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setMessages(prev => prev.some(m => m.id === row.id) ? prev.filter(m => m.id !== tempId) : [...prev.filter(m => m.id !== tempId), row]);
  }, [chat, ensureChat, order?.id]);

  const markRead = useCallback(async () => {
    if (!chat) return;
    const token = getTokens()[order?.id || ''] || chat.customer_session_token;
    if (chat.unread_for_customer > 0) {
      await (supabase as any).rpc('mark_chat_read_by_token', { _chat_id: chat.id, _token: token, _side: 'customer' });
    }
  }, [chat?.id, chat?.unread_for_customer, order?.id]);

  // initial: ensures the chat exists for this order (idempotent) and loads messages via token RPC.
  useEffect(() => {
    if (!order) return;
    setLoading(true);
    (async () => {
      const c = await ensureChat();
      if (c) await fetchMessages(c.id, c.customer_session_token);
      setLoading(false);
    })();
  }, [order?.id]);

  // realtime
  useEffect(() => {
    if (!chat) return;
    const ch = supabase.channel(`order-chat-${chat.id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_chat_messages', filter: `chat_id=eq.${chat.id}` }, (p) => {
        const m = p.new as any;
        setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_chats', filter: `id=eq.${chat.id}` }, (p) => {
        setChat(prev => prev ? { ...prev, ...(p.new as any) } : prev);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chat?.id]);

  return { chat, messages, loading, ensureChat, sendMessage, markRead };
}

// STORE side: list all chats for a tenant + unread totals
export function useStoreOrderChats(tenantId: string | undefined) {
  const [chats, setChats] = useState<OrderChat[]>([]);
  const [loading, setLoading] = useState(true);
  const totalUnreadRef = useRef(0);

  const fetchChats = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from('order_chats' as any).select('*').eq('tenant_id', tenantId).order('last_message_at', { ascending: false, nullsFirst: false });
    setChats((data as any) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    fetchChats();
    const ch = supabase.channel(`tenant-order-chats-${tenantId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_chats', filter: `tenant_id=eq.${tenantId}` }, () => fetchChats())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_chat_messages' }, () => fetchChats())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, fetchChats]);

  const totalUnread = chats.reduce((sum, c) => sum + (c.unread_for_store || 0), 0);
  const prevUnread = totalUnreadRef.current;
  totalUnreadRef.current = totalUnread;

  return { chats, loading, totalUnread, prevUnread, refetch: fetchChats };
}

export function useStoreChatMessages(chatId: string | null) {
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);

  const fetchMessages = useCallback(async () => {
    if (!chatId) return;
    const { data } = await supabase.from('order_chat_messages' as any).select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
    setMessages((data as any) || []);
  }, [chatId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!chatId) return;
    const trimmed = content.trim(); if (!trimmed) return;
    await supabase.from('order_chat_messages' as any).insert({ chat_id: chatId, sender_type: 'store', content: trimmed });
  }, [chatId]);

  const markRead = useCallback(async () => {
    if (!chatId) return;
    await supabase.from('order_chats' as any).update({ unread_for_store: 0 }).eq('id', chatId);
  }, [chatId]);

  useEffect(() => {
    if (!chatId) { setMessages([]); return; }
    fetchMessages();
    const ch = supabase.channel(`store-chat-${chatId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_chat_messages', filter: `chat_id=eq.${chatId}` }, (p) => {
        const m = p.new as any;
        setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chatId, fetchMessages]);

  return { messages, sendMessage, markRead };
}
