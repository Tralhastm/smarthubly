import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Download, Loader2, TrendingUp } from 'lucide-react';

type Row = { tenant_id: string; tenant_name: string; tenant_slug: string; orders: number; gross: number; platform_fee: number };

const monthKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const useFinancialReport = (month: string) => {
  return useQuery({
    queryKey: ['financial-report', month],
    queryFn: async (): Promise<Row[]> => {
      const [year, m] = month.split('-').map(Number);
      const start = new Date(year, m - 1, 1).toISOString();
      const end = new Date(year, m, 1).toISOString();

      const [tenantsRes, ordersRes] = await Promise.all([
        supabase.from('tenants').select('id, name, slug'),
        supabase.from('orders').select('tenant_id, total, platform_fee, status, created_at')
          .gte('created_at', start).lt('created_at', end),
      ]);
      if (tenantsRes.error) throw tenantsRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const tenants = tenantsRes.data || [];
      const orders = (ordersRes.data || []).filter(o => o.status !== 'cancelled');

      return tenants.map(t => {
        const tOrders = orders.filter(o => o.tenant_id === t.id);
        return {
          tenant_id: t.id,
          tenant_name: t.name,
          tenant_slug: t.slug,
          orders: tOrders.length,
          gross: Math.round(tOrders.reduce((s, o) => s + Number(o.total || 0), 0) * 100) / 100,
          platform_fee: Math.round(tOrders.reduce((s, o) => s + Number(o.platform_fee || 0), 0) * 100) / 100,
        };
      }).filter(r => r.orders > 0).sort((a, b) => b.platform_fee - a.platform_fee);
    },
  });
};

const SuperAdminFinancialReport = () => {
  const [month, setMonth] = useState(monthKey(new Date().toISOString()));
  const { data: rows = [], isLoading } = useFinancialReport(month);

  const totals = useMemo(() => ({
    orders: rows.reduce((s, r) => s + r.orders, 0),
    gross: rows.reduce((s, r) => s + r.gross, 0),
    platform_fee: rows.reduce((s, r) => s + r.platform_fee, 0),
  }), [rows]);

  const exportCSV = () => {
    const header = ['Loja', 'Slug', 'Pedidos', 'Faturamento bruto', 'Taxa plataforma'];
    const lines = rows.map(r => [r.tenant_name, r.tenant_slug, r.orders, r.gross.toFixed(2), r.platform_fee.toFixed(2)].join(','));
    lines.push(['TOTAL', '', totals.orders, totals.gross.toFixed(2), totals.platform_fee.toFixed(2)].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `financeiro-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Relatório Financeiro</h2>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground" />
          <button onClick={exportCSV} disabled={rows.length === 0}
            className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Pedidos no mês</p>
          <p className="text-xl font-bold text-foreground">{totals.orders}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Faturamento bruto</p>
          <p className="text-xl font-bold text-primary">R${totals.gross.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Sua taxa</p>
          <p className="text-xl font-bold text-green-400">R${totals.platform_fee.toFixed(2)}</p>
        </div>
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}

      {!isLoading && rows.length === 0 && <p className="text-center text-muted-foreground py-8">Sem pedidos neste mês.</p>}

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.tenant_id} className="rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{r.tenant_name}</p>
              <p className="text-xs text-muted-foreground">{r.orders} pedidos · bruto R${r.gross.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Taxa</p>
              <p className="font-bold text-green-400">R${r.platform_fee.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SuperAdminFinancialReport;
