// Relatórios operacionais: ticket médio por hora/dia, mix de produtos, performance de garçons, picos.
import { useMemo, useState } from 'react';
import { useOperationalReports } from '@/hooks/useReportsSupport';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Clock, TrendingUp, Users, Package } from 'lucide-react';
import { useSubTabs } from '@/lib/admin-subtabs';

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function TenantAdminReports({ tenantId }: { tenantId: string }) {
  const subs = useSubTabs('reports', [
    { id: 'hours', label: 'Horários', icon: <Clock className="h-3 w-3 mr-1" /> },
    { id: 'dow', label: 'Dia', icon: <TrendingUp className="h-3 w-3 mr-1" /> },
    { id: 'mix', label: 'Mix', icon: <Package className="h-3 w-3 mr-1" /> },
    { id: 'waiters', label: 'Garçons', icon: <Users className="h-3 w-3 mr-1" /> },
  ]);
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const { from, to } = useMemo(() => {
    const t = new Date();
    const f = new Date();
    f.setDate(f.getDate() - Number(range));
    return { from: f.toISOString(), to: t.toISOString() };
  }, [range]);

  const { data, isLoading } = useOperationalReports(tenantId, from, to);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Relatórios Operacionais</h2>
        <p className="text-sm text-muted-foreground">Visão profunda do desempenho da operação.</p>
      </div>

      <div className="flex gap-2">
        {(['7', '30', '90'] as const).map(r => (
          <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'} onClick={() => setRange(r)}>
            Últimos {r} dias
          </Button>
        ))}
      </div>

      {isLoading ? <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
      : !data ? <div className="p-6 text-center text-sm text-muted-foreground">Sem dados</div>
      : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Pedidos entregues</div><div className="text-2xl font-semibold">{data.total_orders}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Receita</div><div className="text-2xl font-semibold text-primary">{fmtBRL(data.total_revenue)}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Ticket médio</div><div className="text-2xl font-semibold">{fmtBRL(data.avg_ticket)}</div></CardContent></Card>
          </div>

          <Tabs defaultValue={subs[0].id}>
            <TabsList className="flex w-full flex-wrap justify-start h-auto gap-1">
              {subs.map(s => <TabsTrigger key={s.id} value={s.id} className="flex-shrink-0">{s.icon}{s.label}</TabsTrigger>)}
            </TabsList>

            <TabsContent value="hours" className="mt-4">
              <HourChart rows={data.by_hour} />
            </TabsContent>

            <TabsContent value="dow" className="mt-4">
              <DowChart rows={data.by_dow} />
            </TabsContent>

            <TabsContent value="mix" className="mt-4">
              <ProductMixTable rows={data.product_mix} />
            </TabsContent>

            <TabsContent value="waiters" className="mt-4">
              <WaiterTable rows={data.waiter_performance} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function HourChart({ rows }: { rows: any[] }) {
  const max = Math.max(1, ...rows.map(r => Number(r.orders)));
  const peak = [...rows].sort((a, b) => Number(b.orders) - Number(a.orders))[0];
  return (
    <Card><CardContent className="p-4 space-y-3">
      {peak && <div className="text-sm">Pico de pedidos: <Badge>{String(peak.hour).padStart(2, '0')}h</Badge> com {peak.orders} pedidos</div>}
      <div className="space-y-1">
        {Array.from({ length: 24 }, (_, h) => {
          const row = rows.find(r => Number(r.hour) === h);
          const n = Number(row?.orders || 0);
          const w = max > 0 ? (n / max) * 100 : 0;
          return (
            <div key={h} className="flex items-center gap-2 text-xs">
              <div className="w-8 text-muted-foreground">{String(h).padStart(2, '0')}h</div>
              <div className="flex-1 bg-muted rounded-sm h-5 relative overflow-hidden">
                <div className="bg-primary h-full" style={{ width: `${w}%` }} />
                <div className="absolute inset-0 px-2 flex items-center justify-between">
                  <span>{n} pedidos</span>
                  <span className="text-muted-foreground">{fmtBRL(Number(row?.revenue || 0))}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </CardContent></Card>
  );
}

function DowChart({ rows }: { rows: any[] }) {
  const max = Math.max(1, ...rows.map(r => Number(r.orders)));
  return (
    <Card><CardContent className="p-4 space-y-2">
      {DOW_LABELS.map((label, d) => {
        const row = rows.find(r => Number(r.dow) === d);
        const n = Number(row?.orders || 0);
        const w = max > 0 ? (n / max) * 100 : 0;
        return (
          <div key={d} className="flex items-center gap-2 text-sm">
            <div className="w-10 text-muted-foreground">{label}</div>
            <div className="flex-1 bg-muted rounded-sm h-6 relative overflow-hidden">
              <div className="bg-primary h-full" style={{ width: `${w}%` }} />
              <div className="absolute inset-0 px-2 flex items-center justify-between text-xs">
                <span>{n}</span>
                <span className="text-muted-foreground">{fmtBRL(Number(row?.revenue || 0))}</span>
              </div>
            </div>
          </div>
        );
      })}
    </CardContent></Card>
  );
}

function ProductMixTable({ rows }: { rows: any[] }) {
  return (
    <Card><CardContent className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50"><tr><th className="text-left p-2">#</th><th className="text-left p-2">Produto</th><th className="text-right p-2">Qtde</th><th className="text-right p-2">Receita</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Sem dados</td></tr>
          : rows.map((r, i) => (
            <tr key={r.product_name + i} className="border-t">
              <td className="p-2 text-muted-foreground">{i + 1}</td>
              <td className="p-2">{r.product_name}</td>
              <td className="p-2 text-right">{Number(r.qty).toLocaleString('pt-BR')}</td>
              <td className="p-2 text-right text-primary">{fmtBRL(Number(r.revenue))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent></Card>
  );
}

function WaiterTable({ rows }: { rows: any[] }) {
  return (
    <Card><CardContent className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50"><tr><th className="text-left p-2">Garçom</th><th className="text-right p-2">Pedidos</th><th className="text-right p-2">Ticket médio</th><th className="text-right p-2">Receita</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Sem dados de garçons no período</td></tr>
          : rows.map(r => (
            <tr key={r.waiter_id} className="border-t">
              <td className="p-2">{r.waiter_name}</td>
              <td className="p-2 text-right">{r.orders}</td>
              <td className="p-2 text-right">{fmtBRL(Number(r.avg_ticket))}</td>
              <td className="p-2 text-right text-primary font-medium">{fmtBRL(Number(r.revenue))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent></Card>
  );
}
