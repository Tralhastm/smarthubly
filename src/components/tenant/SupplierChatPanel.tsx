import { useState, useRef, useEffect, useMemo } from 'react';
import { useSupplierChats, useSupplierChatMessages } from '@/hooks/useSupplierChat';
import { MessageCircle, Send, ShieldAlert, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { playShortBeep, unlockAudio } from '@/lib/order-alert-sound';

const LAST_SEEN_KEY = 'supplier_chat_last_seen';

const getLastSeen = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || '{}'); } catch { return {}; }
};
const setLastSeenFor = (chatId: string) => {
  const m = getLastSeen();
  m[chatId] = new Date().toISOString();
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(m));
};

const SupplierChatPanel = ({ supplierId }: { supplierId: string }) => {
  const { chats, loading } = useSupplierChats(supplierId);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const { messages, sendMessage } = useSupplierChatMessages(activeChatId);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevLatestRef = useRef<Record<string, string>>({});
  const initializedRef = useRef(false);

  // Conta mensagens não lidas por chat (baseado em updated_at do chat e last_seen local)
  const lastSeen = useMemo(() => getLastSeen(), [chats]);
  const totalUnread = useMemo(() => {
    return chats.reduce((acc, c) => {
      const seen = lastSeen[c.id];
      if (!seen || new Date(c.updated_at) > new Date(seen)) return acc + 1;
      return acc;
    }, 0);
  }, [chats, lastSeen]);

  // Beep + toast quando algum chat tem nova atualização (novas msgs do cliente)
  useEffect(() => {
    if (!chats.length) return;
    const map: Record<string, string> = {};
    let hasNew = false;
    chats.forEach(c => {
      map[c.id] = c.updated_at;
      const prev = prevLatestRef.current[c.id];
      if (initializedRef.current && prev && c.updated_at > prev && c.id !== activeChatId) {
        hasNew = true;
      }
    });
    if (hasNew) {
      try { unlockAudio(); playShortBeep(); } catch {}
      toast.info('💬 Nova mensagem de cliente', { description: 'Veja na aba Chats' });
    }
    prevLatestRef.current = map;
    initializedRef.current = true;
  }, [chats, activeChatId]);

  // Auto-scroll inteligente: só rola se já estava perto do fim
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distFromBottom < 120) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages]);

  // Marca como visto ao abrir o chat
  useEffect(() => {
    if (activeChatId) setLastSeenFor(activeChatId);
  }, [activeChatId, messages.length]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(msg);
  };

  const activeChat = chats.find(c => c.id === activeChatId);

  if (loading) return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" /></div>;

  // Chat list
  if (!activeChatId) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-medium text-sm text-foreground flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" /> Conversas com clientes
          </h3>
          {totalUnread > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold animate-pulse">
              {totalUnread} nova(s)
            </span>
          )}
        </div>
        {chats.length === 0 && (
          <p className="text-center text-muted-foreground py-8">Nenhuma conversa ativa.</p>
        )}
        {chats.map(chat => {
          const seen = lastSeen[chat.id];
          const isUnread = !seen || new Date(chat.updated_at) > new Date(seen);
          return (
            <button key={chat.id} onClick={() => setActiveChatId(chat.id)}
              className={`w-full text-left rounded-lg border bg-card p-3 hover:border-primary/30 transition-all ${
                isUnread ? 'border-primary/60 ring-1 ring-primary/20' : 'border-border'
              }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">{chat.customer_name || 'Cliente'}</span>
                  {isUnread && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-bold">novo</span>}
                </div>
                <span className="text-xs text-muted-foreground">{new Date(chat.updated_at).toLocaleDateString('pt-BR')}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Produto: {chat.product_name}</p>
            </button>
          );
        })}
      </div>
    );
  }

  // Active chat
  return (
    <div className="flex flex-col h-[60vh]">
      <div className="flex items-center gap-2 pb-3 border-b border-border">
        <button onClick={() => setActiveChatId(null)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <span className="text-sm font-medium text-foreground">{activeChat?.customer_name || 'Cliente'}</span>
          <span className="text-xs text-muted-foreground ml-2">· {activeChat?.product_name}</span>
        </div>
      </div>

      <div className="px-1 py-2 bg-amber-500/10 rounded-lg mt-2">
        <p className="text-[10px] text-amber-400 text-center flex items-center justify-center gap-1">
          <ShieldAlert className="h-3 w-3" /> Dados de contato são bloqueados automaticamente
        </p>
      </div>

      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto py-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhuma mensagem ainda.</p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`text-sm rounded-lg px-3 py-2 ${
            m.sender_type === 'supplier' ? 'bg-primary/10 text-foreground ml-6' : 'bg-secondary text-foreground mr-6'
          }`}>
            <span className="text-[10px] text-muted-foreground block mb-0.5">
              {m.sender_type === 'supplier' ? 'Você' : `👤 ${activeChat?.customer_name || 'Cliente'}`}
            </span>
            {m.content}
            {m.is_filtered && (
              <span className="text-[10px] text-amber-400 block mt-1">⚠️ Conteúdo filtrado</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-border">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Responder cliente..."
          className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <button onClick={handleSend} disabled={!input.trim()}
          className="rounded-lg gradient-primary text-primary-foreground p-2 hover:opacity-90 disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default SupplierChatPanel;
