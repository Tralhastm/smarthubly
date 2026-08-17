import { useMemo } from 'react';
import { useOrders } from '@/hooks/useOrders';
import { DollarSign, ShoppingBag, TrendingUp, Calendar, AlertTriangle, Wallet, ArrowUp, ArrowDown } from 'lucide-react';

const TenantAdminDashboard = ({ tenantId }: { tenantId: string }) => {
  const { data: orders = [], isLoading } = useOrders(tenantId);

  const stats = useMemo(() => {
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = startOfDay(now);
    const yesterday = startOfDay(new Date(now.getTime() - 86400000));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Receita REAL = pedidos ENTREGUES (delivered) excluindo fiado.
    // Fiado vira receita só quando o cliente paga (entrada manual ou aba fiado).
    // Pedidos pendentes (received/preparing/out-for-delivery) não contam aqui.
    const isFiado = (o: any) => (o.payment_method || '').toLowerCase() === 'fiado';
    const realizedOrders = orders.filter(o => o.status === 'delivered' && !isFiado(o));

    const todayOrders = realizedOrders.filter(o => new Date(o.created_at) >= today);
    const yesterdayOrders = realizedOrders.filter(o => {
      const d = new Date(o.created_at);
      return d >= yesterday && d < today;
    });
    const monthOrders = realizedOrders.filter(o => new Date(o.created_at) >= startOfMonth);

    const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.total), 0);
    const yesterdayRevenue = yesterdayOrders.reduce((s, o) => s + Number(o.total), 0);
    const monthRevenue = monthOrders.reduce((s, o) => s + Number(o.total), 0);
    const totalRevenue = realizedOrders.reduce((s, o) => s + Number(o.total), 0);
    const totalFees = realizedOrders.reduce((s, o) => s + Number(o.platform_fee), 0);

    // 7 dias de gráfico
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const day = startOfDay(new Date(now.getTime() - (6 - i) * 86400000));
      const next = new Date(day.getTime() + 86400000);
      const dayOrders = realizedOrders.filter(o => {
        const d = new Date(o.created_at);
        return d >= day && d < next;
      });
      return {
        label: day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
        date: day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        revenue: dayOrders.reduce((s, o) => s + Number(o.total), 0),
        count: dayOrders.length,
      };
    });
    const max7 = Math.max(...last7Days.map(d => d.revenue), 1);

    // Top 3 produtos (apenas pedidos realizados)
    const productRevenue = new Map<string, { name: string; qty: number; revenue: number }>();
    realizedOrders.forEach((o: any) => {
      (o.order_items || []).forEach((it: any) => {
        const cur = productRevenue.get(it.product_name) || { name: it.product_name, qty: 0, revenue: 0 };
        cur.qty += Number(it.quantity);
        cur.revenue += Number(it.product_price) * Number(it.quantity);
        productRevenue.set(it.product_name, cur);
      });
    });
    const topProducts = Array.from(productRevenue.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 3);

    const ticket = realizedOrders.length ? totalRevenue / realizedOrders.length : 0;
    const todayTicket = todayOrders.length ? todayRevenue / todayOrders.length : 0;

    const revenueDelta = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : null;
    const orderDelta = yesterdayOrders.length > 0 ? ((todayOrders.length - yesterdayOrders.length) / yesterdayOrders.length) * 100 : null;

    return {
      todayOrders: todayOrders.length,
      todayRevenue,
      yesterdayRevenue,
      monthRevenue,
      monthCount: monthOrders.length,
      totalRevenue,
      totalFees,
      totalNet: totalRevenue - totalFees,
      ticket,
      todayTicket,
      last7Days,
      max7,
      topProducts,
      revenueDelta,
      orderDelta,
    };
  }, [orders]);

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const Delta = ({ value }: { value: number | null }) => {
    if (value == null) return null;
    const positive = value >= 0;
    return (
      <span className={`inline-flex items-center text-[10px] font-medium ${positive ? 'text-green-500' : 'text-red-500'}`}>
        {positive ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
        {Math.abs(value).toFixed(0)}%
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Métricas hoje em destaque */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ShoppingBag className="h-3 w-3" /> Pedidos hoje
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold text-foreground">{stats.todayOrders}</p>
            <Delta value={stats.orderDelta} />
          </div>
          <p className="text-[10px] text-muted-foreground">vs ontem ({orders.filter(o => {
            const d = new Date(o.created_at);
            const y = new Date(); y.setDate(y.getDate() - 1);
            const fiado = (o.payment_method || '').toLowerCase() === 'fiado';
            return d.toDateString() === y.toDateString() && o.status === 'delivered' && !fiado;
          }).length})</p>
        </div>
        <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <DollarSign className="h-3 w-3" /> Faturamento hoje
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold text-foreground">R${stats.todayRevenue.toFixed(0)}</p>
            <Delta value={stats.revenueDelta} />
          </div>
          <p className="text-[10px] text-muted-foreground">ticket R${stats.todayTicket.toFixed(2)}</p>
        </div>
      </div>

      {/* Gráfico 7 dias */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-primary" /> Últimos 7 dias
        </h3>
        <div className="flex items-end justify-between gap-1.5 h-40">
          {stats.last7Days.map((d, i) => {
            // Reserva ~28px no topo para o label de R$ e ~18px no fundo para o dia da semana
            // Barra ocupa o restante proporcionalmente. Mínimo visível: 6px (mesmo com receita 0).
            const pct = d.revenue > 0 ? (d.revenue / stats.max7) : 0;
            const barPx = Math.max(Math.round(pct * 96), d.revenue > 0 ? 8 : 3);
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                <span className="text-[10px] text-muted-foreground h-3 leading-3">
                  {d.revenue > 0 ? `R$${d.revenue >= 1000 ? (d.revenue / 1000).toFixed(1) + 'k' : d.revenue.toFixed(0)}` : ''}
                </span>
                <div
                  className={`w-full rounded-t-md transition-all hover:opacity-80 ${d.revenue > 0 ? 'gradient-primary' : 'bg-secondary'}`}
                  style={{ height: `${barPx}px` }}
                  title={`${d.date}: R$${d.revenue.toFixed(2)} (${d.count} pedidos)`}
                />
                <span className="text-[10px] text-muted-foreground capitalize">{d.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resumo geral */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground">Mês</p>
          </div>
          <p className="text-lg font-bold text-foreground mt-1">R${stats.monthRevenue.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground">{stats.monthCount} pedidos</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-green-500" />
            <p className="text-xs text-muted-foreground">Líquido total</p>
          </div>
          <p className="text-lg font-bold text-green-500 mt-1">R${stats.totalNet.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground">após taxas</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground">Bruto total</p>
          </div>
          <p className="text-lg font-bold text-foreground mt-1">R${stats.totalRevenue.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground">{orders.length} pedidos</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="text-xs text-muted-foreground">Taxa plataforma</p>
          </div>
          <p className="text-lg font-bold text-destructive mt-1">R${stats.totalFees.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground">total acumulado</p>
        </div>
      </div>

      {/* Top 3 produtos */}
      {stats.topProducts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-sm text-foreground mb-3">🏆 Top produtos</h3>
          <div className="space-y-2">
            {stats.topProducts.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    i === 0 ? 'bg-yellow-500/20 text-yellow-500' :
                    i === 1 ? 'bg-gray-400/20 text-gray-400' :
                    'bg-orange-700/20 text-orange-600'
                  }`}>{i + 1}</span>
                  <span className="text-sm text-foreground truncate">{p.name}</span>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-primary">R${p.revenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">{p.qty}un</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Últimos pedidos */}
      <div>
        <h3 className="font-heading text-sm text-foreground mb-2">Últimos pedidos</h3>
        <div className="space-y-2">
          {orders.slice(0, 5).map(o => (
            <div key={o.id} className="flex items-center justify-between rounded-lg bg-secondary p-3 text-sm">
              <div>
                <span className="font-medium text-foreground">#{o.id.slice(0, 6)}</span>
                <span className="text-muted-foreground ml-2">{o.customer_name}</span>
              </div>
              <span className="font-bold text-primary">R${Number(o.total).toFixed(2)}</span>
            </div>
          ))}
          {orders.length === 0 && <p className="text-center text-muted-foreground py-4 text-sm">Nenhum pedido ainda. Compartilhe sua loja! 🚀</p>}
        </div>
      </div>
    </div>
  );
};

export default TenantAdminDashboard;
