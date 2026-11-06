import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Download, Loader2, Store, TrendingUp, Users, WalletCards } from 'lucide-react';

type Allocation = { name: string; percent?: number; amount: number };
type StoreRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  settlement_status: 'open' | 'received';
  sales_total: number;
  product_cost_total: number;
  operating_cost_total: number;
  net_profit: number;
  split_allocations: Allocation[];
};
type ParticipantTotal = { name: string; amount: number };
type Report = {
  period_start: string;
  period_end: string;
  stores: StoreRow[];
  participant_totals: ParticipantTotal[];
  store_count: number;
  net_profit_total: number;
  sales_total: number;
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoMonthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const money = (value: number | null | undefined) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');

export default function SuperAdminSocietyFinance() {
  const [periodStart, setPeriodStart] = useState(isoMonthStart);
  const [periodEnd, setPeriodEnd] = useState(isoToday);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform-society-finance', periodStart, periodEnd],
    enabled: periodStart <= periodEnd,
    queryFn: async () => {
      const { data: result, error: rpcError } = await (supabase as any).rpc('get_platform_partnership_profit_report', {
        _period_start: periodStart,
        _period_end: periodEnd,
      });
      if (rpcError) throw rpcError;
      return result as Report;
    },
  });

  const report = data || { stores: [], participant_totals: [], store_count: 0, net_profit_total: 0, sales_total: 0 } as Report;
  const receivedCount = useMemo(() => report.stores.filter(row => row.settlement_status === 'received').length, [report.stores]);
  const openCount = report.stores.length - receivedCount;

  const exportCSV = () => {
    const header = ['Loja', 'Slug', 'Faturamento', 'Custo produto', 'Gastos operacionais', 'Lucro líquido', 'Status', 'Participante', 'Percentual', 'Repasse'];
    const lines: string[] = [];
    report.stores.forEach(row => {
      const allocations = row.split_allocations.length ? row.split_allocations : [{ name: 'Sem configuração', amount: 0 }];
      allocations.forEach(allocation => lines.push([
        row.tenant_name, row.tenant_slug, row.sales_total.toFixed(2), row.product_cost_total.toFixed(2), row.operating_cost_total.toFixed(2), row.net_profit.toFixed(2), row.settlement_status,
        allocation.name, allocation.percent == null ? '' : String(allocation.percent), Number(allocation.amount || 0).toFixed(2),
      ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')));
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sociedade-consolidada-${periodStart}-${periodEnd}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <WalletCards className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Financeiro societário</h2>
            <p className="text-xs text-muted-foreground">Consolidado das lojas e repasses conforme a aba Sociedade.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground" />
          <span className="text-xs text-muted-foreground">até</span>
          <input type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground" />
          <button onClick={exportCSV} disabled={report.stores.length === 0} className="flex items-center gap-1 rounded-lg gradient-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
        A apuração usa somente pedidos entregues e pagos, desconta custo do produto e gastos configurados na Sociedade, e distribui apenas o lucro líquido positivo. Nenhum percentual é presumido no painel: cada loja traz a configuração vigente.
      </div>

      {isError && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Não foi possível carregar o consolidado societário: {(error as Error)?.message || 'erro de acesso'}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><Store className="h-3 w-3" /> Lojas no período</p><p className="text-xl font-bold text-foreground">{report.store_count || 0}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Faturamento</p><p className="text-lg font-bold text-primary">{money(report.sales_total)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Lucro líquido consolidado</p><p className="text-lg font-bold text-green-400">{money(report.net_profit_total)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Fechamentos</p><p className="text-sm font-bold text-foreground">{receivedCount} recebidos · {openCount} em aberto</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" /> Total a repassar por participante</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : report.participant_totals.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum repasse calculado no período.</p> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{report.participant_totals.map(participant => <div key={participant.name} className="rounded-lg border border-border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{participant.name}</p><p className="mt-1 text-lg font-bold text-foreground">{money(participant.amount)}</p></div>)}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Detalhamento por loja · {periodStart && dateBR(periodStart)} a {periodEnd && dateBR(periodEnd)}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : report.stores.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma loja com movimento ou configuração societária neste período.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-3 text-left">Loja</th><th className="p-3 text-right">Faturamento</th><th className="p-3 text-right">Custos + gastos</th><th className="p-3 text-right">Lucro líquido</th><th className="p-3 text-left">Repasse configurado</th><th className="p-3 text-center">Fechamento</th></tr></thead><tbody>{report.stores.map(row => <tr key={row.tenant_id} className="border-t align-top"><td className="p-3"><p className="font-medium text-foreground">{row.tenant_name}</p><p className="text-xs text-muted-foreground">{row.tenant_slug}</p></td><td className="p-3 text-right">{money(row.sales_total)}</td><td className="p-3 text-right text-muted-foreground">{money(Number(row.product_cost_total) + Number(row.operating_cost_total))}</td><td className={`p-3 text-right font-bold ${row.net_profit >= 0 ? 'text-green-400' : 'text-destructive'}`}>{money(row.net_profit)}</td><td className="p-3"><div className="space-y-1">{row.split_allocations.length ? row.split_allocations.map(allocation => <div key={allocation.name} className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{allocation.name}{allocation.percent == null ? '' : ` (${allocation.percent}%)`}</span><span className="font-medium text-foreground">{money(allocation.amount)}</span></div>) : <span className="text-xs text-muted-foreground">Sem configuração</span>}</div></td><td className="p-3 text-center"><Badge variant={row.settlement_status === 'received' ? 'default' : 'secondary'}>{row.settlement_status === 'received' ? 'Recebido' : 'Em aberto'}</Badge></td></tr>)}</tbody></table></div>}
        </CardContent>
      </Card>
    </div>
  );
}
