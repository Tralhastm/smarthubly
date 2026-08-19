import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Play, CheckCircle2, XCircle, AlertTriangle, History, Loader2 } from 'lucide-react';


type Status = 'pass' | 'fail' | 'warn';

type TestItem = {
  area: string;
  nome: string;
  status: Status;
  detalhe: string;
  ms: number;
};

type Run = {
  id: number;
  started_at: string;
  total: number;
  passed: number;
  failed: number;
  warn: number;
  results: TestItem[];
};

const statusStyle: Record<Status, string> = {
  pass: 'text-emerald-400',
  fail: 'text-red-400',
  warn: 'text-amber-400',
};

const statusIcon: Record<Status, React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  fail: <XCircle className="h-4 w-4 text-red-400" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-400" />,
};

const AUTO_TEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-test-platform`;

export default function SuperAdminAutoTest() {
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runAll = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(AUTO_TEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}`,
          
        },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Erro do servidor de testes: ${res.status} — ${txt.slice(0, 200)}`);
      }
      const d = (await res.json()) as unknown as Run;
      setCurrent(d);
      // Carregar histórico (últimas 10 execuções)
      const { data } = await supabase
        .from('auto_test_runs')
        .select('id, started_at, total, passed, failed, warn, results')
        .order('id', { ascending: false })
        .limit(10);
      setHistory((data ?? []) as Run[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const totalMs = current ? current.results.reduce((a, r) => a + r.ms, 0) : 0;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl text-foreground">Teste Automático da Plataforma</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Testa sozinho todas as áreas: banco, storage, vitrines, pedidos, financeiro, prospecção, marketing, IA e painéis.
          </p>
        </div>
        <button
          onClick={runAll}
          disabled={running}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/40 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Testando tudo...' : 'Testar tudo automaticamente'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {current && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-heading text-lg text-foreground">Resultado</span>
              {current.failed === 0 ? (
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
                  TUDO APROVADO
                </span>
              ) : (
                <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold text-red-400">
                  {current.failed} FALHA(S)
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {current.passed} aprovados · {current.warn} avisos · {current.failed} falhas · {totalMs > 0 ? `${(totalMs / 1000).toFixed(1)}s` : ''} no total
            </div>
          </div>

          <div className="grid gap-2">
            {current.results.map((r, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-xl border border-border bg-background/50 px-4 py-2.5"
              >
                <span className="mt-0.5">{statusIcon[r.status]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.area}</span>
                    <span className="text-sm font-medium text-foreground">{r.nome}</span>
                    <span className="text-xs text-muted-foreground">{r.ms}ms</span>
                  </div>
                  <p className={`mt-0.5 text-sm ${statusStyle[r.status]}`}>{r.detalhe}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 flex items-center gap-2 font-heading text-lg text-foreground">
            <History className="h-4 w-4" /> Histórico
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4">Quando</th>
                  <th className="pr-4">Total</th>
                  <th className="pr-4">Aprovados</th>
                  <th className="pr-4">Avisos</th>
                  <th>Falhas</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground">{new Date(h.started_at).toLocaleString('pt-BR')}</td>
                    <td className="pr-4">{h.total}</td>
                    <td className="pr-4 text-emerald-400">{h.passed}</td>
                    <td className="pr-4 text-amber-400">{h.warn}</td>
                    <td className={h.failed > 0 ? 'font-bold text-red-400' : 'text-muted-foreground'}>{h.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!current && !running && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Clique em "Testar tudo automaticamente" para iniciar a bateria completa de testes.
        </div>
      )}
    </div>
  );
}
