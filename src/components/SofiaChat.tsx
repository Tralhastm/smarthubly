import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Msg = { role: 'user' | 'assistant'; content: string };

/** Papel travado da Sofia — define identidade fixa e escopo de resposta no backend. */
export type SofiaRole = 'visitor' | 'merchant' | 'supplier' | 'driver';

interface SofiaChatProps {
  /** Papel fixo da IA — controla qual personagem responde (NÃO muda durante a conversa). */
  role?: SofiaRole;
  /** IDs reais pra IA buscar contexto vivo (pedidos abertos, status, etc.). */
  tenantId?: string;
  supplierId?: string;
  driverId?: string;
  /** Mensagem inicial mostrada antes de qualquer interação. */
  greeting?: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat-unified/sofia-agent`;
const PUBLISHABLE = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const SofiaChat = ({
  role = 'visitor',
  tenantId,
  supplierId,
  driverId,
  greeting = 'Oi! Sou a Sofia 👋 Posso tirar dúvidas sobre a plataforma, preços, recursos ou te ajudar a começar. O que você quer saber?',
}: SofiaChatProps) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claraOpen, setClaraOpen] = useState(
    typeof document !== 'undefined' && document.body.dataset.claraOpen === 'true'
  );
  const [suggestClara, setSuggestClara] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  // Some o botão/janela da Sofia enquanto a Clara estiver aberta — evita sobreposição visual.
  useEffect(() => {
    const handler = (e: Event) => {
      const isOpen = (e as CustomEvent).detail === true;
      setClaraOpen(isOpen);
      if (isOpen) setOpen(false);
    };
    window.addEventListener('clara:open', handler);
    return () => window.removeEventListener('clara:open', handler);
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Msg = { role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);

    let assistantSoFar = '';
    let claraSuggested = false;
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      // Detecta o marcador [ABRIR_CLARA] — em vez de abrir direto, marca o estado
      // pra mostrar um botão "Abrir Clara" no rodapé. Usuário decide se quer ou não.
      let visible = assistantSoFar;
      if (visible.includes('[ABRIR_CLARA]')) {
        visible = visible.replace(/\s*\[ABRIR_CLARA\]\s*/g, ' ').trim();
        if (!claraSuggested) {
          claraSuggested = true;
          setSuggestClara(true);
        }
      }
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: visible } : m));
        }
        return [...prev, { role: 'assistant', content: visible }];
      });
    };

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: PUBLISHABLE, 'x-route': '/sofia-agent',
          Authorization: `Bearer ${PUBLISHABLE}`,
        },
        body: JSON.stringify({ messages: next, role, tenantId, supplierId, driverId }),
      });

      if (!resp.ok) {
        const errorBody = await resp.clone().json().catch(() => null);
        if (errorBody?.error) throw new Error(errorBody.error);
        if (resp.status === 429) throw new Error('Muitas mensagens em sequência. Aguarde alguns segundos.');
        if (resp.status === 402) throw new Error('Créditos da IA esgotados. Fale direto no WhatsApp +55 11 91287-0761');
        throw new Error('Falha na conexão. Tenta de novo.');
      }
      if (!resp.body) throw new Error('Sem resposta do servidor');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let done = false;

      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') { done = true; break; }
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content as string | undefined;
            if (c) upsert(c);
          } catch {
            buf = line + '\n' + buf;
            break;
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro inesperado';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = (text: string) => {
    // Markdown muito leve: **bold**, links [txt](url), quebras de linha
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIdx) parts.push(<span key={key++}>{text.slice(lastIdx, m.index)}</span>);
      if (m[1]) {
        parts.push(<strong key={key++} className="text-foreground">{m[1]}</strong>);
      } else if (m[2] && m[3]) {
        parts.push(
          <a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer"
             className="text-primary underline hover:text-primary/80 break-all">{m[2]}</a>
        );
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) parts.push(<span key={key++}>{text.slice(lastIdx)}</span>);
    return parts;
  };

  if (claraOpen) return null;

  return (
    <>
      {/* Botão flutuante + bubble de chamada */}
      {!open && (
        <div className="fixed bottom-5 right-5 z-50 flex items-end gap-2 max-w-[calc(100vw-1.5rem)]">
          {/* Bubble persuasivo (só na landing/visitor) */}
          {role === 'visitor' && (
            <button
              onClick={() => setOpen(true)}
              className={cn(
                'relative bg-card border border-border rounded-2xl rounded-br-sm px-3 py-2',
                'shadow-lg max-w-[220px] text-left animate-in fade-in slide-in-from-right-2',
                'hover:border-primary/50 transition-colors'
              )}
              aria-label="Conversar com Sofia"
            >
              <p className="text-xs leading-snug text-foreground">
                <span className="font-semibold text-primary">Converse com a Sofia</span>
                <br />
                <span className="text-muted-foreground">nossa atendente IA — tire dúvidas agora 👇</span>
              </p>
              <span className="absolute -bottom-1.5 right-3 w-3 h-3 bg-card border-r border-b border-border rotate-45" />
            </button>
          )}

          <button
            onClick={() => setOpen(true)}
            aria-label="Abrir chat com Sofia"
            className={cn(
              'group flex items-center gap-2 pl-3 pr-4 py-3 rounded-full',
              'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground',
              'shadow-lg shadow-primary/30 hover:shadow-primary/50 hover:scale-105',
              'transition-all duration-200 shrink-0'
            )}
          >
            <div className="relative">
              <MessageCircle className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
            </div>
            <span className="font-medium text-sm hidden sm:inline">Sofia</span>
          </button>
        </div>
      )}

      {/* Janela do chat */}
      {open && (
        <div
          className={cn(
            'fixed z-50 bg-card border border-border rounded-2xl shadow-2xl shadow-primary/20',
            'flex flex-col overflow-hidden',
            'inset-x-3 bottom-3 top-16 sm:inset-auto sm:bottom-5 sm:right-5 sm:top-auto sm:w-[380px] sm:h-[560px]'
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-3 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-success border-2 border-card" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading text-sm leading-tight">Sofia</p>
              <p className="text-[11px] text-muted-foreground">Assistente da plataforma · online</p>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" aria-label="Fechar">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Mensagens */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="bg-secondary rounded-2xl rounded-tl-sm px-3 py-2 text-sm leading-relaxed max-w-[85%]">
                  {greeting}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
                {m.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    'rounded-2xl px-3 py-2 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap break-words',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-secondary text-foreground rounded-tl-sm'
                  )}
                >
                  {m.role === 'assistant' ? renderContent(m.content) : m.content}
                </div>
              </div>
            ))}

            {loading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="bg-secondary rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Sugestões rápidas */}
          {messages.length === 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {['Quanto custa?', 'Como funciona a entrega?', 'Atende salão?', 'Quero criar minha loja'].map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-2.5 py-1 rounded-full bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground border border-border transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Sugestão de abrir Clara — só aparece quando a Sofia indicou via [ABRIR_CLARA].
              Exige confirmação explícita do usuário (confirm) antes de abrir, pra evitar
              que a Clara apareça sem ele querer. */}
          {suggestClara && !claraOpen && (
            <div className="px-3 pb-2 space-y-1.5 border-t border-amber-500/30 bg-amber-500/5 pt-2">
              <p className="text-[11px] text-amber-400 font-medium px-1">💼 Quer chamar a Clara (consultora de números)?</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!window.confirm('Abrir a Clara agora? Ela vai analisar os números reais da sua loja.')) return;
                    setSuggestClara(false);
                    setOpen(false);
                    window.dispatchEvent(new CustomEvent('clara:open-request'));
                  }}
                  className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  💼 Sim, chamar a Clara
                </button>
                <button
                  onClick={() => setSuggestClara(false)}
                  className="text-xs px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/70 text-muted-foreground border border-border transition-colors"
                >
                  Não, continua tu
                </button>
              </div>
            </div>
          )}


          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex gap-2 p-3 border-t border-border bg-background"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunta pra Sofia..."
              disabled={loading}
              className="flex-1 px-3 py-2 rounded-lg bg-secondary text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Enviar"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default SofiaChat;
