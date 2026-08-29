// Clara — IA consultora EMPRESARIAL do lojista (réplica enxuta da Clara do FinanceFlow).
// Bottom sheet flutuante. Streaming SSE token a token. Carrega contexto real do negócio
// no backend (não precisa enviar nada do front — a edge function lê tudo do tenantId).

import { useEffect, useRef, useState } from 'react';
import { Briefcase, X, Send, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';

type Msg = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `https://qbcplbcdxoyqpmcehnvu.supabase.co/functions/v1/ai-chat-unified/clara`;
const PUBLISHABLE = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  tenantId: string;
  tenantName?: string;
  open: boolean;
  onClose: () => void;
}

const GREETING = `Oi! Sou a **Clara**, sua consultora empresarial 💼

Eu olho os números reais da sua loja — vendas, margem, fiado, estoque, ticket médio — e te dou conselho prático.

Pode me perguntar coisas tipo:
- "Como tá meu mês?"
- "Tô lucrando ou no prejuízo?"
- "Quem tá me devendo há mais tempo?"
- "Que produto vale eu focar?"`;

const SUGGESTIONS = [
  'Como tá meu mês?',
  'Tô lucrando?',
  'Fiado em aberto',
  'Top produtos',
];

const ClaraChat = ({ tenantId, tenantName, open, onClose }: Props) => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  // Sinaliza globalmente que a Clara está aberta — pra Sofia se esconder e não brigar pelo mesmo canto.
  useEffect(() => {
    if (open) {
      document.body.dataset.claraOpen = 'true';
      window.dispatchEvent(new CustomEvent('clara:open', { detail: true }));
    } else {
      delete document.body.dataset.claraOpen;
      window.dispatchEvent(new CustomEvent('clara:open', { detail: false }));
    }
    return () => {
      delete document.body.dataset.claraOpen;
      window.dispatchEvent(new CustomEvent('clara:open', { detail: false }));
    };
  }, [open]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || !tenantId) return;

    const userMsg: Msg = { role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      // A função exige o token do lojista logado — a chave pública não autentica.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || PUBLISHABLE;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': PUBLISHABLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiY3BsYmNkeG95cXBtY2VobnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTk1NjAsImV4cCI6MjEwMjIzNTU2MH0.Qmg4xBNcLhnPYBlB7EWZyRRLHZqSqnAJZCjkHk1Kl78'
        },
        body: JSON.stringify({ messages: next, tenantId }),
      });

      if (!resp.ok) {
        const body = await resp.clone().json().catch(() => null);
        let msg = body?.error || 'Falha de conexão. Tenta de novo.';
        if (resp.status === 401) msg = 'Sua sessão expirou. Faça login de novo no painel pra falar comigo.';
        if (resp.status === 403) msg = 'Você não tem permissão de admin nesta loja.';
        if (resp.status === 429) msg = 'Muitas mensagens em sequência. Aguarda uns segundos.';
        if (resp.status === 402) msg = 'Créditos da IA esgotados. Avisa o admin.';
        throw new Error(msg);
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
            if (c) {
              setMessages(prev => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === 'assistant') {
                  copy[copy.length - 1] = { ...last, content: last.content + c };
                }
                return copy;
              });
            }
          } catch { buf = line + '\n' + buf; break; }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro inesperado';
      setError(msg);
      setMessages(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === 'assistant' && !last.content) {
          copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
        }
        return copy;
      });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center sm:justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border w-full sm:w-[420px] sm:mr-5 sm:mb-5 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden h-[85vh] sm:h-[600px] animate-in slide-in-from-bottom"
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-3 border-b border-border bg-gradient-to-r from-primary/15 to-transparent">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Briefcase className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-success border-2 border-card" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading text-sm leading-tight">Clara</p>
            <p className="text-[11px] text-muted-foreground truncate">
              Consultora empresarial · {tenantName || 'sua loja'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
            aria-label="Fechar"
          >
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
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{GREETING}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {m.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={`rounded-2xl px-3 py-2 text-sm leading-relaxed max-w-[85%] break-words ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap'
                    : 'bg-secondary text-foreground rounded-tl-sm'
                }`}
              >
                {m.role === 'assistant' ? (
                  m.content ? (
                    <div className="prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Sugestões rápidas */}
        {messages.length === 0 && (
          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
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

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex gap-2 p-3 border-t border-border bg-background"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre o seu negócio..."
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
    </div>
  );
};

export default ClaraChat;
