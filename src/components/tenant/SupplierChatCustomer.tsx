import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, ShieldAlert } from 'lucide-react';
import { useCustomerChat } from '@/hooks/useSupplierChat';

interface Props {
  tenantId: string;
  productId: string;
  supplierId: string;
  productName: string;
}

const SupplierChatCustomer = ({ tenantId, productId, supplierId, productName }: Props) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameSet, setNameSet] = useState(false);
  const [input, setInput] = useState('');
  const { chat, messages, loading, initChat, sendMessage } = useCustomerChat(tenantId, productId, supplierId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStartChat = async () => {
    if (!name.trim()) return;
    setNameSet(true);
    await initChat(name.trim());
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(msg);
  };

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        title="Conversar com fornecedor"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        <span>Chat</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="w-full sm:w-96 max-h-[80vh] flex flex-col rounded-t-xl sm:rounded-xl border border-border bg-background shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border gradient-primary rounded-t-xl">
              <div>
                <span className="text-sm font-medium text-primary-foreground">💬 Chat - {productName}</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <ShieldAlert className="h-3 w-3 text-primary-foreground/70" />
                  <span className="text-[10px] text-primary-foreground/70">Chat protegido pela plataforma</span>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-primary-foreground/80 hover:text-primary-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Name input if not set */}
            {!nameSet ? (
              <div className="p-4 space-y-3">
                <p className="text-sm text-muted-foreground">Para iniciar o chat, informe seu nome:</p>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleStartChat()}
                  placeholder="Seu nome..."
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  autoFocus
                />
                <button onClick={handleStartChat} disabled={!name.trim()}
                  className="w-full rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  Iniciar Chat
                </button>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Warning banner */}
                <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
                  <p className="text-[10px] text-amber-400 text-center">
                    ⚠️ Compartilhar dados de contato pessoal é proibido e será bloqueado automaticamente
                  </p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px] max-h-[50vh]">
                  {messages.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      Envie uma mensagem sobre "{productName}" para o fornecedor 😊
                    </p>
                  )}
                  {messages.map(m => (
                    <div key={m.id} className={`text-sm rounded-lg px-3 py-2 ${
                      m.sender_type === 'customer' ? 'bg-primary/10 text-foreground ml-6' : 'bg-secondary text-foreground mr-6'
                    }`}>
                      <span className="text-[10px] text-muted-foreground block mb-0.5">
                        {m.sender_type === 'customer' ? 'Você' : '🏪 Fornecedor'}
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
                <div className="flex items-center gap-2 p-3 border-t border-border">
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Pergunte sobre o produto..."
                    className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                  <button onClick={handleSend} disabled={!input.trim()}
                    className="rounded-lg gradient-primary text-primary-foreground p-2 hover:opacity-90 disabled:opacity-50">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default SupplierChatCustomer;
