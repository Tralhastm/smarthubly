/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Paperclip, Send, Store, X } from 'lucide-react';
import { useTenantBySlug } from '@/hooks/useTenants';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type SupportChat = { id: string; tenant_id: string; customer_session_token: string; unread_for_customer: number };
type SupportMessage = { id: string; chat_id: string; sender_type: 'customer' | 'store'; content: string; created_at: string; attachment_url?: string | null; attachment_name?: string | null; attachment_type?: string | null; attachment_size?: number | null };
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const isAllowedAttachment = (file: File) => file.type.startsWith('image/') || file.type === 'application/pdf' || file.type.includes('word') || file.type.startsWith('text/');
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
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    if ((!content && !attachment) || !chat || !tenant) return;
    setSending(true);
    let attachmentData: { url: string; name: string; type: string; size: number } | null = null;
    if (attachment) {
      const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${tenant.id}/${chat.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('store-support-attachments').upload(path, attachment, { contentType: attachment.type || 'application/octet-stream', upsert: false });
      if (uploadError) { toast.error('Não foi possível enviar o anexo.'); setSending(false); return; }
      const { data: publicData } = supabase.storage.from('store-support-attachments').getPublicUrl(path);
      attachmentData = { url: publicData.publicUrl, name: attachment.name, type: attachment.type, size: attachment.size };
    }
    setInput(''); setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const token = getSessionToken(tenant.id);
    const { data, error } = await (supabase as any).rpc('send_store_support_message', { _chat_id: chat.id, _session_token: token, _content: content, _attachment_url: attachmentData?.url || null, _attachment_name: attachmentData?.name || null, _attachment_type: attachmentData?.type || null, _attachment_size: attachmentData?.size || null });
    if (!error && data) {
      const message = Array.isArray(data) ? data[0] : data;
      if (message) setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
    }
    if (error) toast.error('Não foi possível enviar a mensagem.');
    setSending(false);
  };

  const chooseAttachment = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) { toast.error('O anexo deve ter no máximo 10 MB.'); return; }
    if (!isAllowedAttachment(file)) { toast.error('Envie uma imagem, PDF, DOC, DOCX ou TXT.'); return; }
    setAttachment(file);
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
        {messages.map(message => <div key={message.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${message.sender_type === 'customer' ? 'ml-auto bg-primary/10 text-foreground' : 'mr-auto bg-secondary text-foreground'}`}><span className="mb-1 block text-[10px] text-muted-foreground">{message.sender_type === 'customer' ? 'Você' : <><Store className="mr-1 inline h-3 w-3" /> Loja</>} · {new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>{message.content}{message.attachment_url && <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-md border border-border/60 bg-background/50 p-2 text-xs text-primary hover:underline">{message.attachment_type?.startsWith('image/') ? <img src={message.attachment_url} alt={message.attachment_name || 'Anexo'} className="h-12 w-12 rounded object-cover" /> : <Paperclip className="h-4 w-4" />}{message.attachment_name || 'Abrir anexo'}</a>}</div>)}
        <div ref={bottomRef} />
      </div>
      {attachment && <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-2 truncate"><Paperclip className="h-4 w-4 shrink-0 text-primary" />{attachment.name}</span><button type="button" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label="Remover anexo"><X className="h-4 w-4" /></button></div>}
      <div className="mt-3 flex items-center gap-2"><input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.txt" className="hidden" onChange={event => chooseAttachment(event.target.files?.[0])} /><button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-border bg-card p-3 text-muted-foreground hover:text-primary" aria-label="Anexar arquivo"><Paperclip className="h-4 w-4" /></button><input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send(); }} placeholder="Digite sua mensagem..." className="flex-1 rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary" autoFocus /><button onClick={() => void send()} disabled={(!input.trim() && !attachment) || sending} className="rounded-lg bg-primary p-3 text-primary-foreground disabled:opacity-50" aria-label="Enviar mensagem"><Send className="h-4 w-4" /></button></div>
    </main>
  </div>;
}
