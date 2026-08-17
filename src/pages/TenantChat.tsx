import { useParams, useNavigate } from 'react-router-dom';
import { useTenantBySlug } from '@/hooks/useTenants';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { filterContactInfo, type ChatMessage, type SupplierChat } from '@/hooks/useSupplierChat';
import { ArrowLeft, MessageCircle, Send, ShieldAlert, Store } from 'lucide-react';

const SESSION_KEY = 'supplier_chat_sessions';

function getAllSessionTokens(): string[] {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    return [...new Set(Object.values(sessions))] as string[];
  } catch { return []; }
}

type ChatWithDetails = SupplierChat & { product_name: string; product_image: string; last_message?: string; last_message_at?: string };

const TenantChat = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: tenant, isLoading: tenantLoading } = useTenantBySlug(slug);

  const [chats, setChats] = useState<ChatWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<ChatWithDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch all customer chats for this tenant
  const fetchChats = useCallback(async () => {
    if (!tenant) return;
    const tokens = getAllSessionTokens();
    if (tokens.length === 0) { setChats([]); setLoading(false); return; }

    const { data } = await supabase.from('supplier_chats')
      .select('*')
      .eq('tenant_id', tenant.id)
      .in('customer_session_token', tokens)
      .order('updated_at', { ascending: false });

    if (!data || data.length === 0) { setChats([]); setLoading(false); return; }

    const productIds = [...new Set(data.map((c: any) => c.product_id))];
    const { data: products } = await supabase.from('products')
      .select('id, name, image').in('id', productIds);
    const productMap = new Map((products || []).map((p: any) => [p.id, p]));

    // Get last message for each chat
    const chatIds = data.map((c: any) => c.id);
    const { data: lastMsgs } = await supabase.from('supplier_chat_messages')
      .select('chat_id, content, created_at, sender_type')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false });

    const lastMsgMap = new Map<string, { content: string; created_at: string; sender_type: string }>();
    for (const msg of (lastMsgs || [])) {
      if (!lastMsgMap.has(msg.chat_id)) {
        lastMsgMap.set(msg.chat_id, msg);
      }
    }

    const enriched: ChatWithDetails[] = (data as SupplierChat[]).map(c => {
      const prod = productMap.get(c.product_id);
      const lastMsg = lastMsgMap.get(c.id);
      return {
        ...c,
        product_name: prod?.name || 'Produto',
        product_image: prod?.image || '',
        last_message: lastMsg ? `${lastMsg.sender_type === 'customer' ? 'Você' : 'Fornecedor'}: ${lastMsg.content}` : undefined,
        last_message_at: lastMsg?.created_at,
      };
    });

    // Sort by last message time
    enriched.sort((a, b) => {
      const ta = a.last_message_at || a.updated_at;
      const tb = b.last_message_at || b.updated_at;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });

    setChats(enriched);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { fetchChats(); }, [fetchChats]);

  // Realtime: refresh chat list when new messages arrive
  useEffect(() => {
    if (!tenant || chats.length === 0) return;
    const chatIds = chats.map(c => c.id);
    const channel = supabase
      .channel('customer-chat-list')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'supplier_chat_messages',
      }, (payload) => {
        const newMsg = payload.new as any;
        if (chatIds.includes(newMsg.chat_id)) {
          // Update chat list with new last message
          setChats(prev => prev.map(c => {
            if (c.id !== newMsg.chat_id) return c;
            return {
              ...c,
              last_message: `${newMsg.sender_type === 'customer' ? 'Você' : 'Fornecedor'}: ${newMsg.content}`,
              last_message_at: newMsg.created_at,
            };
          }).sort((a, b) => {
            const ta = a.last_message_at || a.updated_at;
            const tb = b.last_message_at || b.updated_at;
            return new Date(tb).getTime() - new Date(ta).getTime();
          }));
        }
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenant, chats.length > 0]);

  // Fetch messages for selected chat
  const fetchMessages = useCallback(async (chatId: string) => {
    const { data } = await supabase.from('supplier_chat_messages')
      .select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
    setMessages((data as ChatMessage[]) || []);
  }, []);

  useEffect(() => {
    if (!selectedChat) return;
    fetchMessages(selectedChat.id);
    const channel = supabase
      .channel(`customer-chat-${selectedChat.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'supplier_chat_messages',
        filter: `chat_id=eq.${selectedChat.id}`
      }, (payload) => {
        setMessages(prev => {
          if (prev.some(m => m.id === (payload.new as ChatMessage).id)) return prev;
          return [...prev, payload.new as ChatMessage];
        });
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedChat?.id, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !selectedChat) return;
    const content = input.trim();
    setInput('');

    // Optimistic update
    const optimisticMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      chat_id: selectedChat.id,
      sender_type: 'customer',
      content,
      original_content: null,
      is_filtered: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const { filtered, wasFiltered } = filterContactInfo(content);
    await supabase.from('supplier_chat_messages').insert({
      chat_id: selectedChat.id,
      sender_type: 'customer',
      content: filtered,
      original_content: wasFiltered ? content : null,
      is_filtered: wasFiltered,
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffH = (now.getTime() - d.getTime()) / 3600000;
    if (diffH < 24) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  if (tenantLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>;
  }

  if (!tenant) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Loja não encontrada</p>
    </div>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => selectedChat ? setSelectedChat(null) : navigate(`/loja/${slug}`)}
            className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <MessageCircle className="h-5 w-5 text-primary" />
          <span className="font-heading text-lg text-foreground">
            {selectedChat ? selectedChat.product_name : 'Meus Chats'}
          </span>
        </div>
      </header>

      {/* Chat list or conversation */}
      {!selectedChat ? (
        <div className="flex-1 container mx-auto px-4 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            </div>
          ) : chats.length === 0 ? (
            <div className="text-center py-16">
              <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Nenhuma conversa ainda</p>
              <p className="text-xs text-muted-foreground mt-1">Inicie um chat em um produto para conversar com o fornecedor</p>
            </div>
          ) : (
            <div className="space-y-2">
              {chats.map(chat => (
                <button key={chat.id} onClick={() => setSelectedChat(chat)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/30 transition-all text-left">
                  <div className="w-12 h-12 rounded-md bg-secondary flex-shrink-0 overflow-hidden">
                    {chat.product_image ? (
                      <img src={chat.product_image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Store className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-foreground truncate">{chat.product_name}</span>
                      {chat.last_message_at && (
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-2">
                          {formatTime(chat.last_message_at)}
                        </span>
                      )}
                    </div>
                    {chat.last_message && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{chat.last_message}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Warning */}
          <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
            <div className="flex items-center justify-center gap-1">
              <ShieldAlert className="h-3 w-3 text-amber-400" />
              <p className="text-[10px] text-amber-400">
                Compartilhar dados de contato é proibido e será bloqueado
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                Envie uma mensagem sobre "{selectedChat.product_name}" para o fornecedor 😊
              </p>
            )}
            {messages.map(m => (
              <div key={m.id} className={`text-sm rounded-lg px-3 py-2 max-w-[80%] ${
                m.sender_type === 'customer'
                  ? 'bg-primary/10 text-foreground ml-auto'
                  : 'bg-secondary text-foreground mr-auto'
              }`}>
                <span className="text-[10px] text-muted-foreground block mb-0.5">
                  {m.sender_type === 'customer' ? 'Você' : '🏪 Fornecedor'}
                  <span className="ml-2">{formatTime(m.created_at)}</span>
                </span>
                {m.content}
                {m.is_filtered && (
                  <span className="text-[10px] text-amber-400 block mt-1">⚠️ Parte do conteúdo foi filtrada</span>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 p-3 border-t border-border bg-background">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Pergunte sobre o produto..."
              className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              autoFocus />
            <button onClick={handleSend} disabled={!input.trim()}
              className="rounded-lg gradient-primary text-primary-foreground p-2 hover:opacity-90 disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantChat;
