// Onda 3 — BI Dashboard: KPIs executivos + previsão de demanda + heatmap dia/hora.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, Clock, AlertCircle, Activity, Flame } from 'lucide-react';

interface KPIs {
  today_revenue: number; today_orders: number; yesterday_revenue: number; last_week_revenue: number;
  avg_ticket_30d: number; active_orders: number; cancel_rate_30d: number; best_hour: number | null;
}
interface Forecast { forecast_date: string; dow: number; predicted_orders: number; predicted_revenue: number; confidence: string; }
interface HeatCell { dow: number; hour: number; orders: number; revenue: number; }
interface StuckOrder { id: string; status: string; customer_name: string | null; table_label: string | null; total: number; minutes_stuck: number; severity: 'alerta' | 'critico' | 'ok'; }

const DOW_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function TenantBIDashboard({ tenantId }: { tenantId: string }) {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [forecast, setForecast] = useState<Forecast[]>([]);
  const [heatmap, setHeatmap] = useState<HeatCell[]>([]);
  const [stuck, setStuck] = useState<StuckOrder[]>([]);

  const load = async () => {
    const [k, f, h, s] = await Promise.all([
      (supabase as any).rpc('get_executive_kpis', { _tenant_id: tenantId }),
      (supabase as any).rpc('get_demand_forecast', { _tenant_id: tenantId }),
      (supabase as any).rpc('get_heatmap', { _tenant_id: tenantId, _days: 30 }),
      (supabase as any).rpc('get_stuck_orders', { _tenant_id: tenantId }),
    ]);
    if (k.data) setKpis(k.data);
    if (f.data) setForecast(f.data);
    if (h.data) setHeatmap(h.data);
    if (s.data) setStuck(s.data);
  };

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [tenantId]);

  const diff = (a: number, b: number) => b === 0 ? 0 : ((a - b) / b) * 100;
  const dToday = kpis ? diff(kpis.today_revenue, kpis.yesterday_revenue) : 0;
  const dWeek = kpis ? diff(kpis.today_revenue, kpis.last_week_revenue) : 0;

  // Heatmap helpers
  const maxOrders = Math.max(1, ...heatmap.map(c => c.orders));
  const cellAt = (dow: number, hour: number) => heatmap.find(c => c.dow === dow && c.hour === hour);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="space-y-4">
      {/* Stuck orders alert */}
      {stuck.length > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader><CardTitle className="flex items-center gap-2 text-red-600"><AlertCircle className="w-5 h-5" /> Pedidos travados ({stuck.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1 max-h-60 overflow-y-auto">
            {stuck.map(o => (
              <div key={o.id} className="flex items-center justify-between text-sm rounded border p-2 bg-background">
                <div className="flex items-center gap-2">
                  <Badge variant={o.severity === 'critico' ? 'destructive' : 'default'}>{o.severity}</Badge>
                  <span className="font-medium">{o.table_label || o.customer_name || 'Pedido'}</span>
                  <span className="text-xs text-muted-foreground">{o.status}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold">{o.minutes_stuck.toFixed(0)} min parado</div>
                  <div className="text-xs text-muted-foreground">R$ {Number(o.total).toFixed(2)}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}


      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Faturamento hoje"
          value={`R$ ${(kpis?.today_revenue ?? 0).toFixed(2)}`}
          trend={dToday} trendLabel="vs ontem" />
        <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="vs semana passada"
          value={`${dWeek >= 0 ? '+' : ''}${dWeek.toFixed(1)}%`}
          subtitle={`R$ ${(kpis?.last_week_revenue ?? 0).toFixed(2)} no mesmo dia`} />
        <KpiCard icon={<ShoppingBag className="w-4 h-4" />} label="Pedidos hoje"
          value={String(kpis?.today_orders ?? 0)}
          subtitle={`Ticket médio: R$ ${(kpis?.avg_ticket_30d ?? 0).toFixed(2)}`} />
        <KpiCard icon={<Activity className="w-4 h-4" />} label="Ativos agora"
          value={String(kpis?.active_orders ?? 0)}
          subtitle="Em preparo / entrega" />
        <KpiCard icon={<AlertCircle className="w-4 h-4" />} label="Cancelamento 30d"
          value={`${(kpis?.cancel_rate_30d ?? 0).toFixed(2)}%`}
          subtitle={(kpis?.cancel_rate_30d ?? 0) > 5 ? 'Acima do saudável' : 'Saudável'} />
        <KpiCard icon={<Flame className="w-4 h-4" />} label="Melhor hora (30d)"
          value={kpis?.best_hour != null ? `${kpis.best_hour}h` : '—'}
          subtitle="Maior receita média" />
        <KpiCard icon={<Clock className="w-4 h-4" />} label="Faturamento ontem"
          value={`R$ ${(kpis?.yesterday_revenue ?? 0).toFixed(2)}`} />
        <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Ticket médio 30d"
          value={`R$ ${(kpis?.avg_ticket_30d ?? 0).toFixed(2)}`} />
      </div>

      {/* Forecast */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Previsão de demanda — próximos 7 dias</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Baseado nas últimas 8 semanas (média por dia da semana).</p>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {forecast.map(f => (
              <div key={f.forecast_date} className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground">{DOW_NAMES[f.dow]} {new Date(f.forecast_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</div>
                <div className="text-xl font-bold mt-1">{Number(f.predicted_orders).toFixed(1)}</div>
                <div className="text-xs">pedidos previstos</div>
                <div className="text-sm font-semibold text-primary mt-1">R$ {Number(f.predicted_revenue).toFixed(0)}</div>
                <Badge variant="outline" className="mt-1 text-[10px]">conf. {f.confidence}</Badge>
              </div>
            ))}
            {forecast.length === 0 && <p className="text-sm text-muted-foreground col-span-full">Sem histórico suficiente.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Heatmap */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Flame className="w-5 h-5" /> Mapa de calor — pedidos por dia × hora (30d)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-[10px] border-collapse">
            <thead>
              <tr>
                <th className="p-1"></th>
                {hours.map(h => <th key={h} className="p-1 text-center font-normal text-muted-foreground w-6">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {DOW_NAMES.map((name, dow) => (
                <tr key={dow}>
                  <td className="p-1 pr-2 font-semibold text-muted-foreground">{name}</td>
                  {hours.map(h => {
                    const c = cellAt(dow, h);
                    const intensity = c ? c.orders / maxOrders : 0;
                    const bg = intensity === 0 ? 'hsl(var(--muted) / 0.3)' : `hsl(var(--primary) / ${0.15 + intensity * 0.85})`;
                    return (
                      <td key={h} className="p-0">
                        <div className="w-6 h-6 rounded-sm flex items-center justify-center text-[9px] font-semibold"
                          style={{ background: bg, color: intensity > 0.5 ? 'white' : undefined }}
                          title={c ? `${name} ${h}h: ${c.orders} pedidos · R$ ${Number(c.revenue).toFixed(0)}` : `${name} ${h}h: sem vendas`}>
                          {c?.orders || ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <span>Menos</span>
            {[0.15, 0.35, 0.55, 0.75, 1].map(o => (
              <div key={o} className="w-4 h-4 rounded-sm" style={{ background: `hsl(var(--primary) / ${o})` }} />
            ))}
            <span>Mais</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value, subtitle, trend, trendLabel }: any) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {trend !== undefined && (
          <div className={`text-xs flex items-center gap-1 mt-1 ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend >= 0 ? '+' : ''}{trend.toFixed(1)}% {trendLabel}
          </div>
        )}
        {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
      </CardContent>
    </Card>
  );
}
