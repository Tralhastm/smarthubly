// Editor IA do código-fonte — Super Admin (V2)
//
// Você descreve a mudança, a IA:
// 1. EXPLORA o repositório e escolhe sozinha os arquivos de contexto certos,
// 2. GERA o patch (diff), com autocorreção se a primeira tentativa falhar,
// 3. Você revisa o diff, aplica no código e publica no ar (deploy).
// Histórico completo com desfazer.

import { useState, useEffect } from 'react';
import { Code2, Send, Loader2, CheckCircle2, AlertCircle, Undo2, FileCode2, Clock, History, Rocket, Zap, ScanSearch, GitBranch, ShieldAlert, Database } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-code-editor`;
const INDEX_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/code-index`;

type ExploreResult = {
  chosen_files: string[];
  plan: {
    files_to_modify: string[];
    components_to_create: string[];
    tables_changed: string[];
    risks: string[];
    risk_level: string;
    summary: string;
  };
  reasoning: string;
  dependencies: { path: string; direct: string[]; transitive: string[] }[];
};

type ReqRow = {
  id: string;
  user_id: string;
  request: string;
  patch: string;
  explanation: string | null;
  status: string;
  commit_sha: string | null;
  context_files: string | null;
  created_at: string;
  applied_at: string | null;
  reverted_at: string | null;
  deploy_requested_at: string | null;
  deployed_at: string | null;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending_apply: { text: 'Gerado · aguarda aplicação', cls: 'text-amber-400 bg-amber-500/10' },
  applied: { text: 'Aplicado no código', cls: 'text-blue-400 bg-blue-500/10' },
  pending_deploy: { text: 'Publicando no ar...', cls: 'text-indigo-400 bg-indigo-500/10' },
  deployed: { text: 'No ar', cls: 'text-emerald-400 bg-emerald-500/10' },
  failed: { text: 'Falhou', cls: 'text-red-400 bg-red-500/10' },
  reverted: { text: 'Revertido', cls: 'text-slate-400 bg-slate-500/10' },
};

const SuperAdminAiEditor = () => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [requests, setRequests] = useState<ReqRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoContext, setAutoContext] = useState(true);
  const [analyzeInput, setAnalyzeInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [explore, setExplore] = useState<ExploreResult | null>(null);


  const loadHistory = async () => {
    const { data } = await supabase.from('ai_editor_requests').select('*').order('created_at', { ascending: false }).limit(50);
    if (data) setRequests(data as ReqRow[]);
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const handleAnalyze = async () => {
    const req = analyzeInput.trim();
    if (!req || analyzing) return;
    setAnalyzing(true);
    setExplore(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(`${INDEX_URL}/explore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.session?.access_token}`,
        },
        body: JSON.stringify({ request: req }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Falha na análise de impacto');
        return;
      }
      setExplore(json as ExploreResult);
      toast.success('Análise concluída! Veja o plano da IA abaixo.');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setAnalyzing(false);
    }
  };

  const riskColor = (level?: string) =>
    level === 'alto' ? 'text-red-400 bg-red-500/10' : level === 'medio' ? 'text-amber-400 bg-amber-500/10' : 'text-emerald-400 bg-emerald-500/10';

  const handleSubmit = async () => {
    const req = input.trim();
    if (!req || loading) return;
    setLoading(true);
    setInput('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(`${FN_URL}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.session?.access_token}`,
        },
        body: JSON.stringify({ request: req, auto_context: autoContext }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Falha ao gerar edição', {
          description: json.explanation || undefined,
        });
        setLoading(false);
        return;
      }
      toast.success(json.explanation || 'IA gerou a edição!');
      await loadHistory();
      if (json.id) setExpanded(json.id);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(`${FN_URL}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.session?.access_token}`,
        },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Falha ao aplicar', {
          description: json.message || json.failed_files?.join(', ') || undefined,
        });
        return;
      }
      toast.success('Aplicado no código! Use "Publicar" para levar ao ar.');
      await loadHistory();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeploy = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(`${FN_URL}/notify-deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.session?.access_token}`,
        },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Falha ao solicitar deploy');
        return;
      }
      toast.success('Deploy acionado! O site será publicado em alguns minutos (build + Cloudflare).');
      await loadHistory();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  const handleRevert = async (id: string) => {
    if (busyId) return;
    if (!window.confirm('Reverter esta edição? O código volta ao estado anterior.')) return;
    setBusyId(id);
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(`${FN_URL}/revert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.session?.access_token}`,
        },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Falha ao reverter', {
          description: json.failed_files?.join(', ') || undefined,
        });
        return;
      }
      toast.success('Revertido! O código voltou ao estado anterior.');
      await loadHistory();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  const patchOf = (r: ReqRow): { path: string; old: string; new: string }[] => {
    try { return JSON.parse(r.patch); } catch { return []; }
  };

  const contextOf = (r: ReqRow): string[] => {
    try { return JSON.parse(r.context_files || '[]'); } catch { return []; }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600">
          <Code2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="font-heading text-xl text-foreground flex items-center gap-2">
            Editor IA <span className="rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">V3.1</span>
          </h2>
          <p className="text-sm text-muted-foreground">Descreva a mudança e a IA edita o código-fonte do sistema.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit(); } }}
            placeholder="Ex.: adiciona um badge 'Novo' nos produtos lançados há menos de 7 dias na vitrine..."
            className="min-h-[72px] w-full resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoContext}
                onChange={e => setAutoContext(e.target.checked)}
                className="h-3.5 w-3.5 accent-violet-500"
              />
              <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> IA escolhe o contexto (recomendado)</span>
            </label>
          </div>
          <button
            onClick={() => void handleSubmit()}
            disabled={loading || !input.trim()}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Pedir à IA
          </button>
        </div>
        {autoContext && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            No modo automático a IA explora o repositório inteiro e seleciona os arquivos certos para cada pedido — funciona para qualquer tela, hook ou função do sistema.
          </p>
        )}
      </div>

      {/* V3.1 — Análise de impacto (sem alterar código) */}
      <div className="rounded-xl border border-violet-500/30 bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <ScanSearch className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-medium text-foreground">Analisar impacto <span className="rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 px-1.5 py-0.5 text-[9px] font-bold text-white">V3.1</span></h3>
          <span className="text-[11px] text-muted-foreground">— a IA prevê o que será mexido, sem alterar nada</span>
        </div>
        <div className="flex gap-2">
          <textarea
            value={analyzeInput}
            onChange={e => setAnalyzeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAnalyze(); } }}
            placeholder="Ex.: o que precisaria mudar para adicionar desconto progressivo no carrinho?"
            className="min-h-[56px] w-full resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            onClick={() => void handleAnalyze()}
            disabled={analyzing || !analyzeInput.trim()}
            className="flex items-center gap-2 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/10 disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            Analisar impacto
          </button>
        </div>

        {explore && (
          <div className="mt-4 space-y-3">
            {explore.plan?.summary && (
              <div className="rounded-lg bg-secondary p-3 text-xs text-secondary-foreground">{explore.plan.summary}</div>
            )}
            {explore.reasoning && (
              <p className="text-[11px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Racional:</span> {explore.reasoning}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><FileCode2 className="h-3 w-3" /> Arquivos impactados</p>
                <p className="mt-1 font-mono text-xs text-foreground">{explore.plan?.files_to_modify?.length ?? 0} a modificar · {explore.plan?.components_to_create?.length ?? 0} novos</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Database className="h-3 w-3" /> Banco</p>
                <p className="mt-1 font-mono text-xs text-foreground">{(explore.plan?.tables_changed?.length ?? 0) > 0 ? explore.plan.tables_changed.join(', ') : 'nenhuma tabela alterada'}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><ShieldAlert className="h-3 w-3" /> Risco</p>
                <p className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${riskColor(explore.plan?.risk_level)}`}>
                  {(explore.plan?.risk_level || 'baixo').charAt(0).toUpperCase() + (explore.plan?.risk_level || 'baixo').slice(1)}
                </p>
              </div>
            </div>
            {(explore.dependencies?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><GitBranch className="h-3 w-3" /> Dependências dos arquivos escolhidos</p>
                <div className="max-h-[180px] space-y-1 overflow-auto">
                  {explore.dependencies.map(d => (
                    <p key={d.path} className="text-[11px] text-muted-foreground">
                      <span className="font-mono text-foreground">{d.path.replace('src/', '')}</span>
                      {' → '}{d.direct.length > 0 ? d.direct.map(x => x.replace('src/', '')).join(', ') : 'sem deps diretas'}
                      {d.transitive.length > 0 && <span className="text-muted-foreground/70"> · transitivas: {d.transitive.length}</span>}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setInput(analyzeInput.trim()); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                <Send className="h-3.5 w-3.5" /> Usar para editar com a IA
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-muted-foreground">
        <History className="h-4 w-4" />
        <h3 className="text-sm font-medium">Histórico de edições</h3>
      </div>

      <div className="space-y-3">
        {requests.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma edição ainda. Descreva a primeira mudança acima.
          </div>
        )}
        {requests.map(r => {
          const st = STATUS_LABEL[r.status] || { text: r.status, cls: 'text-slate-400 bg-slate-500/10' };
          const patch = patchOf(r);
          const ctx = contextOf(r);
          const nFiles = patch.length;
          const isExpanded = expanded === r.id;
          const canDeploy = r.status === 'applied';
          const pendingDeploy = r.status === 'pending_deploy';
          return (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{r.request}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {timeAgo(r.created_at)} atrás · {nFiles} arquivo(s) ·{' '}
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${st.cls}`}>
                      {r.status === 'applied' ? <Clock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                      {st.text}
                    </span>
                  </p>
                  {r.explanation && !isExpanded && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{r.explanation}</p>
                  )}
                  {ctx.length > 0 && !isExpanded && (
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      Contexto usado: {ctx.slice(0, 4).map(p => p.replace('src/', '')).join(', ')}{ctx.length > 4 ? ` +${ctx.length - 4}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    onClick={() => setExpanded(isExpanded ? null : r.id)}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <FileCode2 className="h-3.5 w-3.5" /> Diff
                  </button>
                  {r.status === 'pending_apply' && (
                    <button
                      onClick={() => void handleApply(r.id)}
                      disabled={busyId === r.id}
                      className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Aplicar
                    </button>
                  )}
                  {canDeploy && (
                    <button
                      onClick={() => void handleDeploy(r.id)}
                      disabled={busyId === r.id}
                      className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />} Publicar
                    </button>
                  )}
                  {(r.status === 'applied' || r.status === 'deployed') && (
                    <button
                      onClick={() => void handleRevert(r.id)}
                      disabled={busyId === r.id}
                      className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
                      title="Reverte esta edição no código"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Desfazer
                    </button>
                  )}
                  {pendingDeploy && (
                    <span className="flex items-center gap-1 text-[10px] text-indigo-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> Publicando...
                    </span>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 space-y-3">
                  {r.explanation && (
                    <p className="rounded-lg bg-secondary p-3 text-xs text-secondary-foreground">{r.explanation}</p>
                  )}
                  {patch.map((p, i) => (
                    <div key={i} className="overflow-hidden rounded-lg border border-border text-xs">
                      <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-muted-foreground">
                        <FileCode2 className="h-3.5 w-3.5" />
                        <span className="font-mono">{p.path}</span>
                      </div>
                      <div className="max-h-[320px] overflow-auto bg-background/60 p-3 font-mono">
                        <div className="mb-2">
                          <div className="mb-1 text-[10px] font-semibold text-red-400">— removido</div>
                          <pre className="whitespace-pre-wrap text-red-400/90">{p.old}</pre>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] font-semibold text-emerald-400">+ adicionado</div>
                          <pre className="whitespace-pre-wrap text-emerald-400/90">{p.new}</pre>
                        </div>
                      </div>
                    </div>
                  ))}
                  {ctx.length > 0 && (
                    <div className="rounded-lg border border-border p-2 text-[10px] text-muted-foreground">
                      <span className="font-semibold">Arquivos lidos pela IA:</span>{' '}
                      {ctx.join(', ')}
                    </div>
                  )}
                  {r.commit_sha && (
                    <p className="text-xs text-muted-foreground">Commit: <span className="font-mono">{r.commit_sha.slice(0, 7)}</span></p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SuperAdminAiEditor;
