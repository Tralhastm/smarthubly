import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { unifiedInvoke } from "@/lib/unifiedInvoke";

type TenantUsage = {
  id: string; name: string; slug: string; active: boolean;
  billing_mode: string; monthly_fee: number;
  counts: Record<string, number>; total_rows: number;
  orders_30d: number; revenue_30d: number; platform_fees_30d: number;
  estimated_cost_brl: number; billed_brl: number;
  margin_brl: number; margin_pct: number | null;
};

type Totals = {
  tenants: number; total_rows: number; orders_30d: number;
  revenue_30d: number; estimated_cost_brl: number;
  billed_brl: number; margin_brl: number;
};

const SuperAdminUsageMonitor = () => {
  const [data, setData] = useState<{ tenants: TenantUsage[]; totals: Totals; generated_at: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const CACHE_KEY = "smarthubly-usage-monitor";
  const CACHE_TTL = 5 * 60_000;

  const readCache = (): { data: typeof data; at: number } | null => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { at, payload } = JSON.parse(raw);
      if (Date.now() - at > CACHE_TTL) return null;
      return payload;
    } catch { return null; }
  };

  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const { data: res, error } = await unifiedInvoke("finance-unified", "stats", undefined);
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      setData(res);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload: { data: res } }));
      } catch { /* storage indisponível */ }
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally { setLoading(false); }
  };

  // Cache 5min: a função conta EXACT em 12 tabelas × lojas e pode levar ~10s
  useEffect(() => {
    const cached = readCache();
    if (cached?.data) {
      setData(cached.data);
      setCachedAt(cached.at);
      // Recalcula em background sem spinner (os dados em cache já aparecem)
      setLoading(false);
    }
    void load();
  }, []);

  if (loading && !data) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }
  if (err) return <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">Erro: {err}</div>;
  if (!data) return null;

  const t = data.totals;
  const fmt = (n: number) => `R$ ${n.toFixed(2)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl text-foreground">Consumo & Margem por Loja</h2>
          <p className="text-xs text-muted-foreground">Estimativa baseada em dados reais (rows + pedidos 30d). Atualizado: {new Date(data.generated_at).toLocaleString("pt-BR")}{cachedAt && cachedAt < Date.now() - 60_000 ? " · dados salvos por até 5 min" : ""}</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground hover:bg-secondary/80 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Lojas" value={String(t.tenants)} icon={<Activity className="h-4 w-4" />} />
        <Card label="Pedidos 30d" value={String(t.orders_30d)} sub={fmt(t.revenue_30d)} icon={<TrendingUp className="h-4 w-4" />} />
        <Card label="Custo estimado" value={fmt(t.estimated_cost_brl)} sub="infra real" icon={<TrendingDown className="h-4 w-4" />} />
        <Card label="Margem total" value={fmt(t.margin_brl)} sub={`receita ${fmt(t.billed_brl)}`} icon={<TrendingUp className="h-4 w-4" />} highlight={t.margin_brl >= 0} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground">
            <tr>
              <th className="text-left p-3">Loja</th>
              <th className="text-right p-3">Rows</th>
              <th className="text-right p-3">Pedidos 30d</th>
              <th className="text-right p-3">Faturamento</th>
              <th className="text-right p-3">Cobrado</th>
              <th className="text-right p-3">Custo est.</th>
              <th className="text-right p-3">Margem</th>
            </tr>
          </thead>
          <tbody>
            {data.tenants.map(t => {
              const danger = t.margin_brl < 0;
              return (
                <tr key={t.id} className="border-t border-border hover:bg-secondary/40">
                  <td className="p-3">
                    <div className="font-medium text-foreground flex items-center gap-2">
                      {danger && <AlertTriangle className="h-4 w-4 text-destructive" />}
                      {t.name}
                    </div>
                    <div className="text-xs text-muted-foreground">/{t.slug} · {t.billing_mode === "monthly_fixed" ? `mensal R$${t.monthly_fee}` : "% por pedido"}</div>
                  </td>
                  <td className="p-3 text-right text-muted-foreground">{t.total_rows.toLocaleString("pt-BR")}</td>
                  <td className="p-3 text-right text-muted-foreground">{t.orders_30d}</td>
                  <td className="p-3 text-right text-muted-foreground">{fmt(t.revenue_30d)}</td>
                  <td className="p-3 text-right text-foreground">{fmt(t.billed_brl)}</td>
                  <td className="p-3 text-right text-foreground">{fmt(t.estimated_cost_brl)}</td>
                  <td className={`p-3 text-right font-medium ${danger ? "text-destructive" : "text-primary"}`}>
                    {fmt(t.margin_brl)}
                    {t.margin_pct !== null && <span className="text-xs ml-1 opacity-70">({t.margin_pct}%)</span>}
                  </td>
                </tr>
              );
            })}
            {data.tenants.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhuma loja.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground space-y-1">
        <p><strong className="text-foreground">Fórmula de custo:</strong> R$ 0,002 × rows + R$ 0,01 × pedidos/30d + R$ 0,50 base por loja.</p>
        <p>Estimativa conservadora cobrindo: storage Supabase, edge functions, realtime, bandwidth. Ignora custo de IA (gratuito via Lovable AI Gateway).</p>
        <p>Margem negativa = revisar plano da loja ou aplicar limite de uso justo.</p>
      </div>
    </div>
  );
};

const Card = ({ label, value, sub, icon, highlight }: { label: string; value: string; sub?: string; icon: React.ReactNode; highlight?: boolean }) => (
  <div className={`rounded-lg border p-4 ${highlight ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
    <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</div>
    <div className="mt-1 text-lg font-bold text-foreground">{value}</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);

export default SuperAdminUsageMonitor;
