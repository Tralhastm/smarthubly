import { useEffect, useRef, useState } from 'react';
import { useStoreOrderChats, useStoreChatMessages, type OrderChat } from '@/hooks/useOrderChat';
import { supabase } from '@/integrations/supabase/client';
import { MessageCircle, Send, ArrowLeft, Package } from 'lucide-react';
import { toast } from 'sonner';
import { playShortBeep, unlockAudio } from '@/lib/order-alert-sound';

type Props = { tenantId: string; focusOrderId?: string | null };

const TenantAdminCustomerChats = ({ tenantId, focusOrderId }: Props) => {
  const { chats, totalUnread } = useStoreOrderChats(tenantId);
  const [selected, setSelected] = useState<OrderChat | null>(null);
  const [input, setInput] = useState('');
  const { messages, sendMessage, markRead } = useStoreChatMessages(selected?.id || null);
  const prevUnreadRef = useRef(totalUnread);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Som + toast quando aumentar contador
  useEffect(() => {
    if (totalUnread > prevUnreadRef.current) {
      try { unlockAudio(); playShortBeep(); } catch {}
      toast.info('💬 Nova mensagem de cliente', { description: 'Veja na aba Mensagens' });
    }
    prevUnreadRef.current = totalUnread;
  }, [totalUnread]);

  // auto-select via query param
  useEffect(() => {
    if (focusOrderId && !selected) {
      const found = chats.find(c => c.order_id === focusOrderId);
      if (found) setSelected(found);
    }
  }, [focusOrderId, chats, selected]);

  useEffect(() => { if (selected) markRead(); }, [selected?.id, messages.length, markRead]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    const text = input.trim(); if (!text) return;
    setInput('');
    await sendMessage(text);
  };

  const formatTime = (s?: string | null) => {
    if (!s) return '';
    const d = new Date(s); const now = new Date();
    const diffH = (now.getTime() - d.getTime()) / 3600000;
    if (diffH < 24) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  if (selected) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
          <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground text-sm truncate">{selected.customer_name || 'Cliente'}</p>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Package className="h-3 w-3" /> Pedido #{selected.order_id.slice(0, 8)} · {selected.customer_phone}
            </p>
          </div>
        </div>
        <div className="max-h-[60vh] min-h-[300px] overflow-y-auto p-3 space-y-2">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">Nenhuma mensagem ainda neste chat.</p>
          )}
          {messages.map(m => (
            <div key={m.id} className={`text-sm rounded-lg px-3 py-2 max-w-[80%] ${
              m.sender_type === 'store' ? 'bg-blue-500/15 text-foreground ml-auto' : 'bg-secondary text-foreground mr-auto'
            }`}>
              <span className="text-[10px] text-muted-foreground block mb-0.5">
                {m.sender_type === 'store' ? 'Você (loja)' : '👤 Cliente'}
                <span className="ml-2">{formatTime(m.created_at)}</span>
              </span>
              {m.content}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex items-center gap-2 p-2 border-t border-border bg-background">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Responder..."
            className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            autoFocus
          />
          <button onClick={handleSend} disabled={!input.trim()} className="rounded-lg bg-blue-600 text-white p-2 hover:bg-blue-700 disabled:opacity-50">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-foreground flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-blue-400" />
          Mensagens dos clientes
          {totalUnread > 0 && <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{totalUnread}</span>}
        </h2>
      </div>
      {chats.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <MessageCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Nenhuma conversa por enquanto.</p>
          <p className="text-xs text-muted-foreground mt-1">Quando um cliente mandar mensagem em um pedido, aparece aqui.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {chats.map(c => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-blue-500/40 transition text-left"
            >
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-medium text-foreground">{(c.customer_name || 'C').slice(0, 1).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-foreground truncate">{c.customer_name || 'Cliente'}</span>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatTime(c.last_message_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  Pedido #{c.order_id.slice(0, 8)} {c.last_sender === 'customer' ? '· cliente respondeu' : c.last_sender === 'store' ? '· você respondeu' : ''}
                </p>
              </div>
              {c.unread_for_store > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold animate-pulse">{c.unread_for_store}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TenantAdminCustomerChats;
