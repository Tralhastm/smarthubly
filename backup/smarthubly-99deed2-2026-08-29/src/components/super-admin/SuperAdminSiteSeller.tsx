// Vendedor IA — chat pra super admin gerar abordagens e respostas pra colar no WhatsApp.
// Conhece a plataforma inteira + segue o playbook de vendas do dono.
import { useState, useRef, useEffect } from 'react';
import { Send, Copy, Trash2, Sparkles, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Msg = { role: 'user' | 'assistant'; content: string };

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/site-seller`;
const STORAGE_KEY = 'site-seller-history-v1';

const QUICK_PROMPTS = [
  { label: 'Abordagem inicial', value: 'Gera abordagem inicial pra esse lojista:\nNome: \nCidade: \nNicho: \nObservação (insta, site, etc): ' },
  { label: 'Resposta WhatsApp', value: 'Tô conversando com esse lojista no WhatsApp. Cola da conversa abaixo. Me dá a próxima mensagem pronta pra colar:\n\n--- CONVERSA ---\n' },
  { label: 'Quebrar objeção de preço', value: 'O lojista falou que tá caro. Como respondo? Contexto:\n' },
  { label: 'Reengajar quem sumiu', value: 'O lojista sumiu há dias. Última msg que ele mandou foi:\n' },
];

const SuperAdminSiteSeller = () => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch {}
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;
    const userMsg: Msg = { role: 'user', content: text };
    const all = [...messages, userMsg];
    setMessages(all);
    setInput('');
    setLoading(true);

    let assistantSoFar = '';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: all }),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Erro na IA');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const j = line.slice(6).trim();
          if (j === '[DONE]') break;
          try {
            const parsed = JSON.parse(j);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) {
              assistantSoFar += c;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: 'assistant', content: assistantSoFar }];
              });
            }
          } catch { buf = line + '\n' + buf; break; }
        }
      }
    } catch (e: any) {
      toast.error(e.message || 'Falha ao gerar resposta');
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Não consegui gerar agora. Tenta de novo em alguns segundos.' }]);
    }
    setLoading(false);
  };

  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    toast.success('Copiado pro clipboard');
  };

  const clear = () => {
    if (!confirm('Limpar conversa?')) return;
    setMessages([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg gradient-primary p-2 text-primary-foreground">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-heading text-base">Vendedor IA — pro WhatsApp</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Cole a conversa que tá tendo com o lojista. A IA responde a próxima mensagem pra você copiar
              e colar. Conhece a plataforma inteira + o seu playbook de vendas.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card flex flex-col h-[60vh] min-h-[420px]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="flex flex-wrap gap-1">
            {QUICK_PROMPTS.map(q => (
              <button key={q.label} onClick={() => setInput(q.value)}
                className="text-xs px-2 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground">
                <Sparkles className="h-3 w-3 inline mr-1" />{q.label}
              </button>
            ))}
          </div>
          <button onClick={clear} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
            <Trash2 className="h-3 w-3" /> Limpar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-12">
              Comece colando a conversa do WhatsApp ou clique em "Abordagem inicial" acima.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`group flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`relative max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-primary/15 text-foreground'
                  : 'bg-secondary text-foreground'
              }`}>
                {m.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown>{m.content || '...'}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                )}
                {m.role === 'assistant' && m.content && (
                  <button
                    onClick={() => copy(m.content)}
                    className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-full bg-primary text-primary-foreground p-1 shadow"
                    title="Copiar"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
              placeholder="Cole a conversa, peça abordagem, faça pergunta... (Ctrl+Enter envia)"
              rows={3}
              className="flex-1 resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="rounded-lg gradient-primary text-primary-foreground p-3 hover:opacity-90 disabled:opacity-50 self-end"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminSiteSeller;
