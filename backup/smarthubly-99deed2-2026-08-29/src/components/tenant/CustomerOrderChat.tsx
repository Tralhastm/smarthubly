import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Store } from 'lucide-react';
import { useCustomerOrderChat } from '@/hooks/useOrderChat';

type Props = {
  order: { id: string; tenant_id: string; customer_name?: string | null; customer_phone?: string | null };
  tenantName?: string;
};

const CustomerOrderChat = ({ order, tenantName }: Props) => {
  const { chat, messages, sendMessage, ensureChat, markRead } = useCustomerOrderChat(order);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => { if (open) markRead(); }, [open, chat?.unread_for_customer, markRead]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (!chat) await ensureChat();
    await sendMessage(text);
  };

  const unread = chat?.unread_for_customer || 0;

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 p-4 hover:bg-blue-500/10 transition"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-blue-400" />
          <span className="font-bold text-foreground text-sm">Falar com a loja sobre este pedido</span>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold animate-pulse">{unread}</span>
          )}
          <span className="text-xs text-blue-400">{open ? 'fechar' : 'abrir'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-blue-500/20">
          <div className="max-h-72 overflow-y-auto p-3 space-y-2 bg-background/40">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">
                Mande sua dúvida sobre o pedido — a loja{tenantName ? ` ${tenantName}` : ''} responde por aqui 👋
              </p>
            )}
            {messages.map(m => (
              <div key={m.id} className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                m.sender_type === 'customer'
                  ? 'bg-primary/10 text-foreground ml-auto'
                  : 'bg-secondary text-foreground mr-auto'
              }`}>
                <span className="text-[10px] text-muted-foreground block mb-0.5">
                  {m.sender_type === 'customer' ? 'Você' : <><Store className="inline h-3 w-3 mr-1" />Loja</>}
                  <span className="ml-2">{new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                </span>
                {m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="flex items-center gap-2 p-2 border-t border-blue-500/20 bg-background">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Digite sua mensagem..."
              className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="rounded-lg bg-blue-600 text-white p-2 hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerOrderChat;
