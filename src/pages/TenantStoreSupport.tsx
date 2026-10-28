/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Send, Store } from 'lucide-react';
import { useTenantBySlug } from '@/hooks/useTenants';
import { supabase } from '@/integrations/supabase/client';

type SupportChat = { id: string; tenant_id: string; customer_session_token: string; unread_for_customer: number };
type SupportMessage = { id: string; chat_id: string; sender_type: 'customer' | 'store'; content: string; created_at: string };
const tokenKey = (tenantId: string) => `store_support_session_${tenantId}`;
const getSessionToken = (tenantId: string) => {
  const key = tokenKey(tenantId);
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const token = `${crypto.randomUUID()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, token);
  return token;
};

export default function TenantStoreSupport() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: tenant, isLoading } = useTenantBySlug(slug);
  const [chat, setChat] = useState<SupportChat | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    const start = async () => {
      const token = getSessionToken(tenant.id);
      const { data, error } = await (supabase as any).rpc('find_or_create_store_support_chat', { _tenant_id: tenant.id, _session_token: token });
      if (error || cancelled || !data) { setLoading(false); return; }
      const current = Array.isArray(data) ? data[0] : data;
      setChat(current);
      const { data: rows } = await (supabase as any).rpc('list_store_support_messages', { _chat_id: current.id, _session_token: token });
      if (!cancelled) { setMessages(rows || []); setLoading(false); }
    };
    void start();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  useEffect(() => {
    if (!chat) return;
    const channel = supabase.channel(`store-support-customer-${chat.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_support_messages', filter: `chat_id=eq.${chat.id}` }, payload => {
        const message = payload.new as SupportMessage;
        setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [chat?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content || !chat || !tenant) return;
    setInput(''); setSending(true);
    const token = getSessionToken(tenant.id);
    const { data, error } = await (supabase as any).rpc('send_store_support_message', { _chat_id: chat.id, _session_token: token, _content: content });
    if (!error && data) {
      const message = Array.isArray(data) ? data[0] : data;
      if (message) setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
    }
    setSending(false);
  };

  if (isLoading || loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!tenant) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loja não encontrada</div>;

  return <div className="min-h-screen bg-background flex flex-col">
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="container mx-auto flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(`/loja/${slug}`)} className="text-muted-foreground hover:text-foreground" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></button>
        {tenant.logo_url ? <img src={tenant.logo_url} alt="" className="h-9 w-9 rounded-md object-cover" /> : <Store className="h-5 w-5 text-primary" />}
        <div><p className="font-heading text-lg text-foreground">Suporte</p><p className="text-xs text-muted-foreground">Fale diretamente com {tenant.name}</p></div>
      </div>
    </header>
    <main className="flex-1 container mx-auto flex w-full max-w-2xl flex-col px-4 py-4">
      <div className="mb-3 rounded-lg bg-primary/10 p-3 text-xs text-muted-foreground"><MessageCircle className="mr-1 inline h-4 w-4 text-primary" /> Envie sua dúvida. A loja responderá por este chat.</div>
      <div className="flex-1 space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-3">
        {messages.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">Ainda não há mensagens. Como podemos ajudar?</p>}
        {messages.map(message => <div key={message.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${message.sender_type === 'customer' ? 'ml-auto bg-primary/10 text-foreground' : 'mr-auto bg-secondary text-foreground'}`}><span className="mb-1 block text-[10px] text-muted-foreground">{message.sender_type === 'customer' ? 'Você' : <><Store className="mr-1 inline h-3 w-3" /> Loja</>} · {new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>{message.content}</div>)}
        <div ref={bottomRef} />
      </div>
      <div className="mt-3 flex items-center gap-2"><input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send(); }} placeholder="Digite sua mensagem..." className="flex-1 rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary" autoFocus /><button onClick={() => void send()} disabled={!input.trim() || sending} className="rounded-lg bg-primary p-3 text-primary-foreground disabled:opacity-50" aria-label="Enviar mensagem"><Send className="h-4 w-4" /></button></div>
    </main>
  </div>;
}
