import { useState } from 'react';
import { useStoreHealth } from '@/hooks/useStoreHealth';
import { Activity, TrendingUp, AlertTriangle, Clock, Bot, Hand, Loader2, Download } from 'lucide-react';

const fmtMin = (m: number | null) => m == null ? '—' : m < 60 ? `${m} min` : `${(m / 60).toFixed(1)}h`;
const fmtBRL = (v: number) => `R$${v.toFixed(2)}`;

const SuperAdminStoreHealth = () => {
  const [days, setDays] = useState(30);
  const { data: rows = [], isLoading } = useStoreHealth(days);

  const exportCSV = () => {
    const header = [
      'Loja', 'Slug', 'Pedidos', 'Entregues', 'Cancelados', 'Taxa cancel %',
      'Ticket médio', 'Faturamento bruto', 'Taxa plataforma',
      'Automação %', 'Auto-avanços', 'Auto-atribuições', 'Manuais',
      'Recebido→Preparo', 'Preparo→Saída', 'Saída→Entregue', 'Total médio',
    ];
    const lines = rows.map(r => [
      r.tenant_name, r.tenant_slug, r.total_orders, r.delivered, r.cancelled, r.cancel_rate,
      r.avg_ticket, r.gross_revenue, r.platform_fee_total,
      r.automation_rate, r.auto_advance_count, r.auto_assign_count, r.manual_count,
      r.avg_received_to_preparing_min ?? '', r.avg_preparing_to_out_min ?? '',
      r.avg_out_to_delivered_min ?? '', r.avg_total_min ?? '',
    ].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `saude-lojas-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Saúde das Lojas</h2>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground">
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
          <button onClick={exportCSV}
            className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      {rows.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhuma loja com dados no período.</p>}

      <div className="space-y-3">
        {rows.map(r => {
          const healthScore = Math.round(
            (r.automation_rate * 0.4) +
            ((100 - r.cancel_rate) * 0.3) +
            (Math.min(r.total_orders / 10, 10) * 3)
          );
          const healthColor = healthScore >= 70 ? 'text-green-400 bg-green-500/10 border-green-500/30'
            : healthScore >= 40 ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
            : 'text-red-400 bg-red-500/10 border-red-500/30';

          return (
            <div key={r.tenant_id} className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="font-semibold text-foreground">{r.tenant_name}</h3>
                  <p className="text-xs text-muted-foreground">/{r.tenant_slug}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${healthColor}`}>
                  Saúde: {healthScore}/100
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg bg-secondary p-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Pedidos</p>
                  <p className="font-bold text-foreground">{r.total_orders}</p>
                  <p className="text-xs text-muted-foreground">{r.delivered} entregues</p>
                </div>
                <div className="rounded-lg bg-secondary p-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Cancelamento</p>
                  <p className={`font-bold ${r.cancel_rate > 15 ? 'text-red-400' : 'text-foreground'}`}>{r.cancel_rate}%</p>
                  <p className="text-xs text-muted-foreground">{r.cancelled} cancelados</p>
                </div>
                <div className="rounded-lg bg-secondary p-2">
                  <p className="text-xs text-muted-foreground">Ticket médio</p>
                  <p className="font-bold text-primary">{fmtBRL(r.avg_ticket)}</p>
                  <p className="text-xs text-muted-foreground">Bruto: {fmtBRL(r.gross_revenue)}</p>
                </div>
                <div className="rounded-lg bg-secondary p-2">
                  <p className="text-xs text-muted-foreground">Taxa plataforma</p>
                  <p className="font-bold text-green-400">{fmtBRL(r.platform_fee_total)}</p>
                  <p className="text-xs text-muted-foreground">no período</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-border bg-secondary/50 p-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Bot className="h-3 w-3" /> Automação</p>
                  <p className="font-bold text-foreground">{r.automation_rate}%</p>
                  <p className="text-xs text-muted-foreground">
                    🤖 {r.auto_advance_count + r.auto_assign_count} auto · <Hand className="inline h-3 w-3" /> {r.manual_count} manual
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/50 p-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Tempo total médio</p>
                  <p className="font-bold text-foreground">{fmtMin(r.avg_total_min)}</p>
                  <p className="text-xs text-muted-foreground">do recebimento à entrega</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground border-t border-border pt-2">
                <div><span className="block text-[10px] uppercase">Recebido→Preparo</span><span className="font-semibold text-foreground">{fmtMin(r.avg_received_to_preparing_min)}</span></div>
                <div><span className="block text-[10px] uppercase">Preparo→Saída</span><span className="font-semibold text-foreground">{fmtMin(r.avg_preparing_to_out_min)}</span></div>
                <div><span className="block text-[10px] uppercase">Saída→Entregue</span><span className="font-semibold text-foreground">{fmtMin(r.avg_out_to_delivered_min)}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SuperAdminStoreHealth;
