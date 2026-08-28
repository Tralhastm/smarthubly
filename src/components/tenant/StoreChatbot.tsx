import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type Msg = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `https://qbcplbcdxoyqpmcehnvu.supabase.co/functions/v1/ai-chat-unified/store`;

const StoreChatbot = ({ tenantName, niche, tenantId }: { tenantName: string; niche: string; tenantId: string }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Msg = { role: 'user', content: input.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput('');
    setLoading(true);

    let assistantSoFar = '';
    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiY3BsYmNkeG95cXBtY2VobnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTk1NjAsImV4cCI6MjEwMjIzNTU2MH0.Qmg4xBNcLhnPYBlB7EWZyRRLHZqSqnAJZCjkHk1Kl78',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiY3BsYmNkeG95cXBtY2VobnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTk1NjAsImV4cCI6MjEwMjIzNTU2MH0.Qmg4xBNcLhnPYBlB7EWZyRRLHZqSqnAJZCjkHk1Kl78'}`
        },
        body: JSON.stringify({ messages: allMessages, tenantName, niche, tenantId }),
      });

      if (!resp.ok || !resp.body) throw new Error('Erro na IA');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: 'assistant', content: assistantSoFar }];
              });
            }
          } catch { textBuffer = line + '\n' + textBuffer; break; }
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Desculpe, ocorreu um erro. Tente novamente.' }]);
    }
    setLoading(false);
  };

  if (!niche) return null;

  return (
    <>
      {!open && (
        <button data-splash-floating="true" onClick={() => setOpen(true)}
          aria-label="Abrir assistente"
          className="fixed bottom-28 left-6 z-50 rounded-full gradient-primary text-primary-foreground p-3 shadow-lg hover:opacity-90 transition-all">
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div data-splash-floating="true" className="fixed bottom-24 left-6 right-6 sm:right-auto z-50 w-auto sm:w-80 max-h-[70vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border gradient-primary rounded-t-xl">
            <span className="text-sm font-medium text-primary-foreground">💬 Assistente {tenantName}</span>
            <button onClick={() => setOpen(false)} className="text-primary-foreground/80 hover:text-primary-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px] max-h-[50vh]">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Olá! Posso tirar dúvidas e te ajudar a escolher 😊</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`text-sm rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-primary/10 text-foreground ml-6' : 'bg-secondary text-foreground mr-6'}`}>
                {m.role === 'assistant' ? (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                ) : m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="flex items-center gap-2 p-3 border-t border-border">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()} placeholder="Pergunte algo..."
              className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
            <button onClick={send} disabled={loading} className="rounded-lg gradient-primary text-primary-foreground p-2 hover:opacity-90 disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default StoreChatbot;
