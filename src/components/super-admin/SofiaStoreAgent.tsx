// 🤖 Sofia Agente de Loja — painel no admin da loja
// Fluxo: lojista pede algo em linguagem natural → IA gera PLANO → lojista revisa → aplica → pode reverter.
import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Loader2, Send, RotateCcw, RefreshCw, CheckCircle2, XCircle, History, Eye, Palette, Package, Wand2, MapPin, Store, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const AGENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sofia-store-agent`;

// Detecta intenção de aplicar direto: "aplica", "aplica tudo", "faz e aplica", "aplica ja"
const wantsAutoApply = (text: string): boolean =>
  /\baplica\b/i.test(text) || /\baplicar\b/i.test(text) || /\bj\s*[aá]\s+aplica/i.test(text) || /faz\s+e\s+aplica/i.test(text);

type PlanItem = {
  id: string;
  newName?: string;
  newDescription?: string;
  newPrice?: number;
  newImagePrompt?: string;
};

type Plan = {
  id: string;
  status: string;
  user_request: string;
  rationale: string;
  created_at: string;
  applied_at?: string;
};

const SofiaStoreAgent = ({ tenantId, tenantName }: { tenantId: string; tenantName: string }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [current, setCurrent] = useState<any>(null); // plano pendente em revisão
  const [plans, setPlans] = useState<Plan[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<any>(null); // detalhes do plano selecionado p/ revisão
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [current]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase.functions.invoke('sofia-store-agent', {
        body: { tenantId, action: 'list' },
      });
      // usa endpoint /plans via invoke genérico — a EF só aceita POST /plan? Não: vamos usar o
      // helper abaixo que chama as rotas com path. (Implementado via query param path)
      void data; void error;
    } finally {
      setLoadingHistory(false);
    }
  };

  const invoke = async (path: string, body: any) => {
    const { data, error } = await supabase.functions.invoke('sofia-store-agent', {
      body: { ...body, _path: path },
    });
    if (error) throw new Error(error.message || 'Falha na conexão com a Sofia Agente');
    if (data?.error) throw new Error(data.error === 'ai_unavailable' ? 'A IA está instável agora. Tenta de novo em alguns segundos.' : data.error);
    return data;
  };

  const loadPlans = async () => {
    setLoadingHistory(true);
    try {
      const data = await invoke('plans', { tenantId });
      setPlans(data.plans || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar histórico');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (tenantId) loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setLoading(true);
    setCurrent(null);
    setDetails(null);
    try {
      const data = await invoke('plan', { tenantId, messages: [{ role: 'user', content: text }], autoApply: wantsAutoApply(text) });
      setCurrent(data);
      toast.success(data.status === 'applied' ? 'Sofia aplicou as mudanças direto!' : 'Sofia montou o plano! Revise antes de aplicar.');
      await loadPlans();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar o plano');
    } finally {
      setLoading(false);
      setInput('');
    }
  };

  const apply = async () => {
    if (!current?.planId || loading) return;
    setLoading(true);
    try {
      const data = await invoke('apply', { planId: current.planId });
      setCurrent({ ...current, status: data.status, applied: data.applied, errors: data.errors });
      toast.success(data.message);
      await loadPlans();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao aplicar');
    } finally {
      setLoading(false);
    }
  };

  const retryImages = async (planId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await invoke('retry-images', { planId });
      toast.success(data.message);
      await loadPlans();
      if (current?.planId === planId) setCurrent({ ...current, applied: [...(current.applied || []), ...(data.applied || [])] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao regenerar fotos');
    } finally {
      setLoading(false);
    }
  };

  const rollback = async (planId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await invoke('rollback', { planId });
      toast.success(data.message);
      setExpanded(null);
      setDetails(null);
      await loadPlans();
      if (current?.planId === planId) setCurrent(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reverter');
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (plan: Plan) => {
    if (expanded === plan.id) { setExpanded(null); setDetails(null); return; }
    setExpanded(plan.id);
    try {
      const { data } = await supabase.functions.invoke('sofia-store-agent', {
        body: { tenantId, _path: 'plan-detail', planId: plan.id },
      });
      setDetails(data?.plan || null);
    } catch {
      setDetails(null);
    }
  };

  const statusBadge = (s: string) => {
    if (s === 'pending') return { label: 'Aguardando', cls: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' };
    if (s === 'applied') return { label: 'Aplicado', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' };
    if (s === 'rolled_back') return { label: 'Revertido', cls: 'bg-slate-500/15 text-slate-500 border-slate-500/30' };
    return { label: s, cls: 'bg-red-500/15 text-red-600 border-red-500/30' };
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-start gap-3 p-4 border-b border-border">
          <div className="h-9 w-9 rounded-lg gradient-primary flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="font-heading text-sm text-foreground">Sofia Agente de Loja — {tenantName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Peça em linguagem natural (ex: "deixa a loja mais premium", "melhora os preços", "troca as fotos dos produtos").
              Para aplicar direto sem revisar, diga "aplica" no pedido.
            </p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div ref={scrollRef} className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {current ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5 text-primary" /> O que a Sofia vai mudar:
                </p>
                <p className="text-muted-foreground mt-1 text-xs italic">{current.rationale || current.message}</p>
                {current.prospecting && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1"><Store className="h-3 w-3 text-primary" /> Prospecção {current.query && `— ${current.query}`}</p>
                    {current.leads?.length > 0 ? (
                      <>
                        <p className="text-xs text-emerald-600 mt-1">{current.leads.length} empresas encontradas em {current.city}{current.state ? `, ${current.state}` : ''}</p>
                        <div className="mt-1.5 max-h-48 overflow-y-auto space-y-1.5 pr-1">
                          {(current.leads || []).slice(0, 15).map((l: any) => (
                            <div key={l.id} className="rounded border border-border bg-background px-2.5 py-1.5 text-xs">
                              <p className="font-medium text-foreground flex items-center gap-1">
                                <MapPin className="h-3 w-3 text-primary shrink-0" />
                                {l.business_name}
                                {l.priority_score ? <span className="ml-auto text-[10px] text-muted-foreground">score {l.priority_score}</span> : null}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {[l.neighborhood, l.city, l.state].filter(Boolean).join(' — ') || l.address}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10px]">
                                {l.phone && <span className="text-muted-foreground">📞 {l.phone}</span>}
                                {l.instagram_handle && <span className="text-muted-foreground">📷 @{l.instagram_handle}</span>}
                                {l.website_url && <a href={l.website_url} target="_blank" rel="noreferrer" className="text-primary flex items-center gap-0.5">🌐 site <ExternalLink className="h-2.5 w-2.5" /></a>}
                                {l.maps_url && <a href={l.maps_url} target="_blank" rel="noreferrer" className="text-primary flex items-center gap-0.5">🗺️ mapa</a>}
                              </div>
                            </div>
                          ))}
                          {(current.leads || []).length > 15 && (
                            <p className="text-[10px] text-muted-foreground">+ {(current.leads || []).length - 15} outras empresas</p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">{current.message}</p>
                    )}
                  </div>
                )}
                {!current.prospecting && current.tenantChanges && Object.keys(current.tenantChanges).length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1"><Palette className="h-3 w-3" /> Identidade da loja</p>
                    {(Object.entries(current.tenantChanges) as [string, any][]).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-32">{k === 'brand_primary_color' ? 'Cor principal' : k === 'brand_bg_color' ? 'Fundo' : k === 'splash_bg_color' ? 'Splash' : k}</span>
                        {k.includes('color') && v ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-3.5 w-3.5 rounded border border-border" style={{ backgroundColor: v }} />
                            <span className="font-mono">{v}</span>
                          </span>
                        ) : (
                          <span className="truncate">{String(v)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {(current.productChanges || []).length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1"><Package className="h-3 w-3" /> Produtos ({(current.productChanges as PlanItem[]).length})</p>
                    {(current.productChanges as PlanItem[]).slice(0, 12).map((p) => (
                      <div key={p.id} className="text-xs text-muted-foreground pl-2 border-l border-border">
                        {p.newPrice != null && <span>Preço → R$ {Number(p.newPrice).toFixed(2)} · </span>}
                        {p.newName && <span>Nome → {p.newName} · </span>}
                        {p.newImagePrompt && <span>📸 foto nova gerada · </span>}
                        {p.newDescription && <span>descrição nova · </span>}
                        <span className="font-mono text-[10px] opacity-60">{p.id.slice(0, 8)}…</span>
                      </div>
                    ))}
                    {(current.productChanges as PlanItem[]).length > 12 && (
                      <p className="text-xs text-muted-foreground">+ {(current.productChanges as PlanItem[]).length - 12} outros produtos</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nenhum plano em revisão agora. Digite seu pedido abaixo 👇
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder={`Ex: "deixa a ${tenantName} com visual premium cinza e dourado"`}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-primary-foreground transition-colors',
                loading || !input.trim() ? 'opacity-50 cursor-not-allowed bg-primary/60' : 'gradient-primary hover:opacity-90'
              )}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {loading ? 'Gerando...' : 'Gerar plano'}
            </button>
          </div>
          {current?.planId && current.status !== 'applied' && (
            <div className="flex gap-2">
              <button
                onClick={apply}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" /> Aplicar mudanças
              </button>
              <button
                onClick={() => { setCurrent(null); }}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <XCircle className="h-4 w-4" /> Descartar
              </button>
            </div>
          )}
          {current?.status === 'applied' && current.applied?.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Aplicado! {current.applied.length} mudança(s). Reverta quando quiser no histórico abaixo.
              </p>
              {(current.errors || []).some((e: string) => e.includes('foto')) && (
                <button
                  onClick={() => retryImages(current.planId)}
                  disabled={loading}
                  className="text-xs flex items-center gap-1 rounded-md border border-amber-500/40 px-2.5 py-1.5 text-amber-700 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Regenerar fotos que falharam
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Histórico */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-heading text-sm text-foreground">Histórico de planos</h3>
          {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />}
        </div>
        <div className="p-4 space-y-2">
          {plans.length === 0 && !loadingHistory && (
            <p className="text-xs text-muted-foreground text-center py-2">Nenhum plano ainda. O primeiro pedido aparece aqui.</p>
          )}
          {plans.map((p) => {
            const badge = statusBadge(p.status);
            const open = expanded === p.id;
            return (
              <div key={p.id} className="rounded-md border border-border">
                <button
                  onClick={() => openDetails(p)}
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-secondary/50 transition-colors"
                >
                  <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{p.user_request}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(p.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', badge.cls)}>{badge.label}</span>
                </button>
                {open && details && (
                  <div className="border-t border-border p-3 space-y-1.5 bg-secondary/30">
                    <p className="text-xs text-muted-foreground italic">{details.rationale}</p>
                    {details.tenantChanges && Object.keys(details.tenantChanges).length > 0 && (
                      <p className="text-xs text-foreground">Identidade: {Object.entries(details.tenantChanges).map(([k, v]) => `${k}=${String(v)}`).join(', ')}</p>
                    )}
                    {(details.productChanges || []).length > 0 && (
                      <p className="text-xs text-foreground">{(details.productChanges as PlanItem[]).length} produto(s) alterado(s) no plano</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      {p.status === 'applied' && (
                        <button
                          onClick={() => rollback(p.id)}
                          disabled={loading}
                          className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" /> Reverter este plano
                        </button>
                      )}
                      {p.status === 'pending' && (
                        <button
                          onClick={async () => {
                            setCurrent({ ...details, planId: p.id, status: 'pending' });
                            setExpanded(null);
                            toast.info('Plano carregado para revisão. Toque em Aplicar quando aprovar.');
                          }}
                          className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs text-white hover:bg-emerald-700 transition-colors"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Revisar e aplicar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SofiaStoreAgent;
