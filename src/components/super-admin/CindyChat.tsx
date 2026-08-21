// Cindy — copiloto de IA do super admin (agora com AÇÕES REAIS).
// Visão GLOBAL: vê todas as lojas, faturamento, infra de IA, cobranças, saúde do sistema.
// Botão flutuante rosa no canto inferior direito do super admin.
//
// AÇÕES: quando a Cindy termina a resposta com um bloco ```cindy-action {json}```,
// o frontend executa a ação de verdade (gera o post / grava resposta no chamado).

import { useState, useRef, useEffect } from 'react';
import { Heart, X, Send, Loader2, Settings, Save, Sparkles, Star, Zap, Bot, MessageCircle, Flame, Crown, Coffee, Palette, CheckCircle2, Copy, Download, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Msg = { role: 'user' | 'assistant'; content: string; action?: CindyAction | null };

type CindyAction =
  | { tool: 'gen-post'; payload: Record<string, unknown>; result?: any }
  | { tool: 'reply-ticket'; payload: { ticketId: string; content: string; setResolved?: boolean }; result?: any };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat-unified/cindy`;
const ACTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat-unified/cindy-actions`;

const GREETING = 'Opa Erick — sou a Cindy, sua copiloto do super admin. Vejo todas as lojas, pedidos rolando agora, faturamento, cobranças e saúde da IA. Posso gerar posts de marketing e responder chamados por você — é só pedir.';

const ICON_OPTIONS = {
  heart: Heart, sparkles: Sparkles, star: Star, zap: Zap, bot: Bot,
  message: MessageCircle, flame: Flame, crown: Crown, coffee: Coffee,
} as const;
type IconKey = keyof typeof ICON_OPTIONS;

const COLOR_PRESETS: { key: string; label: string; gradient: string; headerBg: string; bubbleBg: string; accentText: string; accentFill: string; ring: string; shadow: string; swatch: string }[] = [
  { key: 'pink',    label: 'Rosa',     gradient: 'bg-gradient-to-br from-pink-500 to-rose-600',       headerBg: 'bg-gradient-to-r from-pink-500/15 to-rose-500/5',       bubbleBg: 'bg-pink-500/20',    accentText: 'text-pink-400',    accentFill: 'fill-pink-400',    ring: 'focus:ring-pink-500/40',    shadow: 'shadow-pink-500/30 hover:shadow-pink-500/50',       swatch: 'from-pink-500 to-rose-600' },
  { key: 'purple',  label: 'Roxo',     gradient: 'bg-gradient-to-br from-purple-500 to-fuchsia-600',  headerBg: 'bg-gradient-to-r from-purple-500/15 to-fuchsia-500/5',  bubbleBg: 'bg-purple-500/20',  accentText: 'text-purple-400',  accentFill: 'fill-purple-400',  ring: 'focus:ring-purple-500/40',  shadow: 'shadow-purple-500/30 hover:shadow-purple-500/50',   swatch: 'from-purple-500 to-fuchsia-600' },
  { key: 'blue',    label: 'Azul',     gradient: 'bg-gradient-to-br from-blue-500 to-indigo-600',     headerBg: 'bg-gradient-to-r from-blue-500/15 to-indigo-500/5',     bubbleBg: 'bg-blue-500/20',    accentText: 'text-blue-400',    accentFill: 'fill-blue-400',    ring: 'focus:ring-blue-500/40',    shadow: 'shadow-blue-500/30 hover:shadow-blue-500/50',       swatch: 'from-blue-500 to-indigo-600' },
  { key: 'emerald', label: 'Verde',    gradient: 'bg-gradient-to-br from-emerald-500 to-teal-600',    headerBg: 'bg-gradient-to-r from-emerald-500/15 to-teal-500/5',    bubbleBg: 'bg-emerald-500/20', accentText: 'text-emerald-400', accentFill: 'fill-emerald-400', ring: 'focus:ring-emerald-500/40', shadow: 'shadow-emerald-500/30 hover:shadow-emerald-500/50', swatch: 'from-emerald-500 to-teal-600' },
  { key: 'amber',   label: 'Âmbar',    gradient: 'bg-gradient-to-br from-amber-500 to-orange-600',    headerBg: 'bg-gradient-to-r from-amber-500/15 to-orange-500/5',    bubbleBg: 'bg-amber-500/20',   accentText: 'text-amber-400',   accentFill: 'fill-amber-400',   ring: 'focus:ring-amber-500/40',   shadow: 'shadow-amber-500/30 hover:shadow-amber-500/50',     swatch: 'from-amber-500 to-orange-600' },
  { key: 'red',     label: 'Vermelho', gradient: 'bg-gradient-to-br from-red-500 to-rose-700',        headerBg: 'bg-gradient-to-r from-red-500/15 to-rose-700/5',        bubbleBg: 'bg-red-500/20',     accentText: 'text-red-400',     accentFill: 'fill-red-400',     ring: 'focus:ring-red-500/40',     shadow: 'shadow-red-500/30 hover:shadow-red-500/50',         swatch: 'from-red-500 to-rose-700' },
  { key: 'slate',   label: 'Grafite',  gradient: 'bg-gradient-to-br from-slate-600 to-slate-800',     headerBg: 'bg-gradient-to-r from-slate-600/15 to-slate-800/5',     bubbleBg: 'bg-slate-500/20',   accentText: 'text-slate-300',   accentFill: 'fill-slate-300',   ring: 'focus:ring-slate-500/40',   shadow: 'shadow-slate-500/30 hover:shadow-slate-500/50',     swatch: 'from-slate-600 to-slate-800' },
];

// Bloco de ação pode vir em QUALQUER posição da resposta final (o modelo às vezes escreve mais depois do bloco)
const ACTION_BLOCK_RE = /```cindy-action\s*\n([\s\S]*?)```/m;
const ACTION_JSON_RE = /\{(?:[^{}]|\{[^{}]*\})*\}/;

function parseActionBlock(text: string): CindyAction | null {
  const m = text.match(ACTION_BLOCK_RE);
  if (!m) return null;
  // Tenta o 1º JSON válido dentro do bloco (aceita texto extra, quebra de linha etc.)
  const inner = m[1];
  const jm = inner.match(ACTION_JSON_RE);
  if (!jm) return null;
  try {
    const json = JSON.parse(jm[0]);
    if (json?.tool === 'gen-post' || json?.tool === 'reply-ticket') {
      return { tool: json.tool, payload: json.payload || {} } as CindyAction;
    }
  } catch { /* json inválido — ignora */ }
  return null;
}

const CindyChat = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [loadedPrompt, setLoadedPrompt] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null); // id do action executando
  const [iconKey, setIconKey] = useState<IconKey>(() => (localStorage.getItem('cindy-icon') as IconKey) || 'heart');
  const [colorKey, setColorKey] = useState<string>(() => localStorage.getItem('cindy-color') || 'pink');
  const scrollRef = useRef<HTMLDivElement>(null);

  const ChosenIcon = ICON_OPTIONS[iconKey] ?? Heart;
  const palette = COLOR_PRESETS.find(p => p.key === colorKey) ?? COLOR_PRESETS[0];

  const updateIcon = (k: IconKey) => { setIconKey(k); localStorage.setItem('cindy-icon', k); };
  const updateColor = (k: string) => { setColorKey(k); localStorage.setItem('cindy-color', k); };

  useEffect(() => {
    if (!open || loadedPrompt) return;
    (async () => {
      const { data } = await supabase
        .from('platform_settings').select('value').eq('key', 'cindy_custom_prompt').maybeSingle();
      const txt = (data?.value as any)?.text;
      if (typeof txt === 'string') setCustomPrompt(txt);
      setLoadedPrompt(true);
    })();
  }, [open, loadedPrompt]);

  const savePrompt = async () => {
    setSavingPrompt(true);
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase.from('platform_settings').upsert({
      key: 'cindy_custom_prompt',
      value: { text: customPrompt },
      updated_by: userRes?.user?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    setSavingPrompt(false);
    if (error) {
      toast.error('Não consegui salvar: ' + error.message);
    } else {
      toast.success(customPrompt.trim() ? 'Cindy ajustada 💗' : 'Voltei pro padrão');
      setShowSettings(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

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
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: 'assistant', content: assistantSoFar }];
      });
    };
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Sessão expirada — faça login de novo.');
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next }),
      });
      if (!resp.ok) {
        const errorBody = await resp.clone().json().catch(() => null);
        if (errorBody?.error) throw new Error(errorBody.error);
        if (resp.status === 403) throw new Error('Acesso restrito ao super admin.');
        if (resp.status === 429) throw new Error('Muitas mensagens em sequência. Espera uns segundos.');
        if (resp.status === 402) throw new Error('Sem créditos de IA agora.');
        throw new Error('Falha de conexão.');
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
      // ===== Execução de ações: a resposta contém um bloco ```cindy-action```? =====
      const finalContent = assistantSoFar;
      const action = parseActionBlock(finalContent);
      if (action) {
        const actionId = `${action.tool}-${Date.now()}`;
        setMessages(prev => prev.map((m, i) =>
          (i === prev.length - 1 ? { ...(m as Msg & { actionId?: string }), action, actionId } : m)));
        (async () => {
          setActionBusy(actionId);
          // Timeout de segurança: se a geração demorar demais, mostra aviso em vez de ficar infinito
          const guard = setTimeout(() => {
            setMessages(prev => prev.map((m, i) =>
              (i === prev.length - 1 && (m as any).actionId === actionId ? { ...(m as Msg), result: { content: '' } } : m)));
          }, 45_000);
          try {
            const { data: sess } = await supabase.auth.getSession();
            const tok = sess?.session?.access_token;
            const endpoint = action.tool === 'gen-post' ? '/gen-post' : '/reply-ticket';
            const res = await fetch(`${ACTIONS_URL}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
              body: JSON.stringify(action.payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              const reason = data?.error || `erro ${res.status}`;
              toast.error(`Ação falhou: ${reason}`);
              // reescreve o bloco da IA com o motivo
              setMessages(prev => prev.map((m, i) => {
                if (i === prev.length - 1 && (m as any).actionId === actionId) {
                  return { ...m, action: null };
                }
                return m;
              }));
              return;
            }
            setMessages(prev => prev.map((m, i) => {
              if (i === prev.length - 1 && (m as any).actionId === actionId) {
                return { ...m, action: { ...m.action, result: data } };
              }
              return m;
            }));
          } catch (e: any) {
            toast.error('Falha ao executar a ação');
            setMessages(prev => prev.map((m, i) => {
              if (i === prev.length - 1 && (m as any).actionId === actionId) return { ...m, action: null };
              return m;
            }));
          } finally {
            clearTimeout(guard);
            setActionBusy(null);
          }
        })();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  };

  const renderContent = (text: string) => {
    // remove o bloco de ação da exibição (fica no card da ação)
    const cleaned = text.replace(/```cindy-action\s*\n[\s\S]*?```/m, '').replace(/\n+$/, '');
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = regex.exec(cleaned)) !== null) {
      if (m.index > lastIdx) parts.push(<span key={key++}>{cleaned.slice(lastIdx, m.index)}</span>);
      if (m[1]) parts.push(<strong key={key++} className="text-foreground">{m[1]}</strong>);
      else if (m[2] && m[3]) parts.push(
        <a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer" className="text-pink-400 underline hover:text-pink-300 break-all">{m[2]}</a>
      );
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < cleaned.length) parts.push(<span key={key++}>{cleaned.slice(lastIdx)}</span>);
    return parts;
  };

  const downloadImage = (dataUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copiado!');
    } catch {
      toast.error('Não consegui copiar');
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir chat com Cindy"
          className={cn(
            'fixed bottom-5 right-5 z-50 group flex items-center gap-2 pl-3 pr-4 py-3 rounded-full text-white',
            palette.gradient,
            'shadow-lg hover:scale-105 transition-all duration-200',
            palette.shadow
          )}
        >
          <div className="relative">
            <ChosenIcon className="h-5 w-5 fill-white" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <span className="font-medium text-sm hidden sm:inline">Cindy</span>
        </button>
      )}

      {open && (
        <div className={cn(
          'fixed z-50 bg-card border border-border rounded-2xl shadow-2xl',
          'flex flex-col overflow-hidden',
          'inset-x-3 bottom-3 top-16 sm:inset-auto sm:bottom-5 sm:right-5 sm:top-auto sm:w-[400px] sm:h-[600px]'
        )}>
          <div className={cn('flex items-center gap-3 p-3 border-b border-border', palette.headerBg)}>
            <div className="relative">
              <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', palette.gradient)}>
                <ChosenIcon className="h-5 w-5 text-white fill-white" />
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-card" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading text-sm leading-tight">Cindy 💗</p>
              <p className="text-[11px] text-muted-foreground">Copiloto do super admin · gera posts e responde chamados</p>
            </div>
            <button onClick={() => setShowSettings(s => !s)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" aria-label="Ajustes">
              <Settings className="h-4 w-4 text-muted-foreground" />
            </button>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" aria-label="Fechar">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {showSettings && (
            <div className="absolute inset-0 top-[60px] z-10 bg-card flex flex-col p-4 gap-4 overflow-y-auto">
              <div>
                <h3 className="font-heading text-sm mb-1 flex items-center gap-1.5"><Palette className="h-3.5 w-3.5" /> Aparência do botão</h3>
                <p className="text-[11px] text-muted-foreground">Escolha cor e ícone — salva só nesse dispositivo.</p>
              </div>

              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Cor</p>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => updateColor(p.key)}
                      title={p.label}
                      className={cn(
                        'w-8 h-8 rounded-full bg-gradient-to-br transition-all',
                        p.swatch,
                        colorKey === p.key ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground scale-110' : 'opacity-80 hover:opacity-100'
                      )}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Ícone</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(ICON_OPTIONS) as IconKey[]).map(k => {
                    const Ic = ICON_OPTIONS[k];
                    const active = iconKey === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => updateIcon(k)}
                        className={cn(
                          'w-9 h-9 rounded-lg flex items-center justify-center transition-all border',
                          active ? cn(palette.gradient, 'text-white border-transparent scale-110') : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                        )}
                      >
                        <Ic className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="h-px bg-border my-1" />

              <div>
                <h3 className="font-heading text-sm mb-1">Personalize a Cindy</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Escreva instruções extras pra moldar como ela responde (tom, prioridades, atalhos, palavras proibidas...).
                  Se deixar em branco, ela segue o comportamento padrão.
                </p>
              </div>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Ex: Sempre comece pelo número de pedidos abertos. Não use emoji. Me chame só de Erick."
                className={cn('flex-1 min-h-[140px] resize-none px-3 py-2 rounded-lg bg-secondary text-sm border border-border focus:outline-none focus:ring-2', palette.ring)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setCustomPrompt(''); }}
                  className="px-3 py-2 text-xs rounded-lg bg-secondary hover:bg-secondary/70 text-muted-foreground"
                >Limpar (voltar ao padrão)</button>
                <button
                  type="button"
                  onClick={savePrompt}
                  disabled={savingPrompt}
                  className={cn('ml-auto px-3 py-2 text-xs rounded-lg text-white flex items-center gap-1.5 disabled:opacity-50', palette.gradient)}
                >
                  {savingPrompt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Salvar
                </button>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex gap-2">
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', palette.bubbleBg)}>
                  <ChosenIcon className={cn('h-3.5 w-3.5', palette.accentText, palette.accentFill)} />
                </div>
                <div className="bg-secondary rounded-2xl rounded-tl-sm px-3 py-2 text-sm leading-relaxed max-w-[85%]">
                  {GREETING}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const msg = m as Msg & { actionId?: string };
              const action = msg.action as CindyAction | null | undefined;
              const actionResult = action?.result;
              const actionError = actionResult?.error;
              const isBusy = msg.actionId && actionBusy === msg.actionId;
              return (
                <div key={i}>
                  <div className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
                    {m.role === 'assistant' && (
                      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', palette.bubbleBg)}>
                        <ChosenIcon className={cn('h-3.5 w-3.5', palette.accentText, palette.accentFill)} />
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-3 py-2 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap break-words',
                      m.role === 'user'
                        ? cn(palette.gradient, 'text-white rounded-tr-sm')
                        : 'bg-secondary text-foreground rounded-tl-sm'
                    )}>
                      {m.role === 'assistant' ? renderContent(m.content) : m.content}
                    </div>
                  </div>

                  {/* ===== Card de ação executada ===== */}
                  {action && (
                    <div className="mt-2 ml-9 rounded-xl border border-border bg-card/80 overflow-hidden text-xs">
                      {action.tool === 'gen-post' ? (
                        actionError ? (
                          <div className="flex items-start gap-2 p-3 text-destructive">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold mb-0.5">Post não foi gerado</p>
                              <p className="text-destructive/80">{actionError}</p>
                            </div>
                          </div>
                        ) : actionResult ? (
                          <div>
                            {actionResult.image && (
                              <img src={actionResult.image} alt="Arte do post" className="w-full aspect-square object-contain bg-black/80" />
                            )}
                            <div className="p-3 space-y-2">
                              <div className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Post pronto — salvável
                              </div>
                              <div className="max-h-48 overflow-y-auto rounded-lg bg-secondary px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
                                {actionResult.content}
                              </div>
                              {actionResult.overlay?.title1 && (
                                <div className="rounded-lg bg-secondary px-2.5 py-2">
                                  <p className="font-semibold text-foreground">{actionResult.overlay.title1}</p>
                                  {actionResult.overlay.subtitle && (
                                    <p className="text-muted-foreground mt-0.5">{actionResult.overlay.subtitle}</p>
                                  )}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                <button
                                  onClick={() => copyText(actionResult.content || '')}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground border border-border"
                                >
                                  <Copy className="h-3 w-3" /> Copiar legenda
                                </button>
                                {actionResult.image && (
                                  <button
                                    onClick={() => downloadImage(actionResult.image, `post-${Date.now()}.png`)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground border border-border"
                                  >
                                    <Download className="h-3 w-3" /> Baixar imagem
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-3 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Gerando o post...
                          </div>
                        )
                      ) : (
                        actionError ? (
                          <div className="flex items-start gap-2 p-3 text-destructive">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold mb-0.5">Resposta não enviada</p>
                              <p className="text-destructive/80">{actionError}</p>
                            </div>
                          </div>
                        ) : actionResult ? (
                          <div className="flex items-start gap-2 p-3">
                            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                            <div>
                              <p className="font-semibold text-emerald-700 mb-0.5">
                                Resposta gravada no chamado{actionResult.subject ? ` "${actionResult.subject}"` : ''}
                              </p>
                              <p className="text-muted-foreground">
                                {actionResult.setResolved !== false ? 'Chamado marcado como resolvido.' : 'Aparece na aba Suporte, no fio do ticket.'}
                              </p>
                            </div>
                          </div>
                        ) : isBusy ? (
                          <div className="flex items-center gap-2 p-3 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Gravando a resposta...
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-3 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {loading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-2">
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', palette.bubbleBg)}>
                  <ChosenIcon className={cn('h-3.5 w-3.5', palette.accentText, palette.accentFill)} />
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

          {messages.length === 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {['Gera um post de marketing pra mim', 'Resumo do dia', 'Top 3 lojas do mês', 'Chamados abertos'].map(s => (
                <button key={s} onClick={() => send(s)}
                  className="text-xs px-2.5 py-1 rounded-full bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground border border-border transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex gap-2 p-3 border-t border-border bg-background">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pede post, análise ou resposta de chamado..."
              disabled={loading}
              className={cn('flex-1 px-3 py-2 rounded-lg bg-secondary text-sm border border-border focus:outline-none focus:ring-2 disabled:opacity-50', palette.ring)}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className={cn('px-3 rounded-lg text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity', palette.gradient)}
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

export default CindyChat;
