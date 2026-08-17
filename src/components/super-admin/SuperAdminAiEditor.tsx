// Editor IA do código-fonte — Super Admin
//
// Você descreve a mudança, a IA gera o patch (com preview do diff),
// aplica no repositório GitHub e dispara o deploy. Histórico com desfazer.

import { useState, useEffect, useRef } from 'react';
import { Code2, Send, Loader2, CheckCircle2, AlertCircle, Undo2, FileCode2, Clock, History, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-code-editor`;

// Arquivos de contexto enviados à IA para reduzir alucinação
const KNOWN_PAGES = [
  'src/pages/SuperAdmin.tsx',
  'src/pages/TenantAdmin.tsx',
  'src/pages/TenantStore.tsx',
  'src/pages/WaiterPanel.tsx',
  'src/pages/Kds.tsx',
];

type ReqRow = {
  id: string;
  user_id: string;
  request: string;
  patch: string;
  explanation: string | null;
  status: string;
  commit_sha: string | null;
  created_at: string;
  applied_at: string | null;
  reverted_at: string | null;
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
  pending_apply: { text: 'Aguardando aplicação', cls: 'text-amber-400 bg-amber-500/10' },
  applied: { text: 'Aplicado · aguarda build', cls: 'text-blue-400 bg-blue-500/10' },
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
  const listRef = useRef<HTMLDivElement>(null);

  const loadHistory = async () => {
    const { data } = await supabase.from('ai_editor_requests').select('*').order('created_at', { ascending: false }).limit(50);
    if (data) setRequests(data as ReqRow[]);
  };

  useEffect(() => {
    void loadHistory();
  }, []);

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
        body: JSON.stringify({ request: req, context_files: KNOWN_PAGES }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Falha ao gerar edição');
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
        toast.error(json.error || 'Falha ao aplicar');
        return;
      }
      toast.success('Aplicado no repositório! O build e deploy entram na fila de validação (poucos minutos).');
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
        toast.error(json.error || 'Falha ao reverter');
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600">
          <Code2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="font-heading text-xl text-foreground">Editor IA</h2>
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
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            A IA gera um preview da mudança. Ao aplicar, ela vai para o repositório e entra na fila de build + deploy (costuma levar poucos minutos).
          </p>
          <button
            onClick={() => void handleSubmit()}
            disabled={loading || !input.trim()}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Pedir à IA
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-muted-foreground">
        <History className="h-4 w-4" />
        <h3 className="text-sm font-medium">Histórico de edições</h3>
      </div>

      <div ref={listRef} className="space-y-3">
        {requests.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma edição ainda. Descreva a primeira mudança acima.
          </div>
        )}
        {requests.map(r => {
          const st = STATUS_LABEL[r.status] || { text: r.status, cls: 'text-slate-400 bg-slate-500/10' };
          const patch = patchOf(r);
          const nFiles = patch.length;
          const isExpanded = expanded === r.id;
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
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
