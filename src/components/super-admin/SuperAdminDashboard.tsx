import { useTenants } from '@/hooks/useTenants';
import { useAllOrders } from '@/hooks/useOrders';
import { Store, DollarSign, ShoppingBag, TrendingUp } from 'lucide-react';

const SuperAdminDashboard = () => {
  const { data: tenants = [] } = useTenants();
  const { data: orders = [], isLoading } = useAllOrders({ refetchInterval: 30000 });

  const activeTenants = tenants.filter(t => t.active);
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const totalPlatformFees = orders.reduce((s, o) => s + o.platform_fee, 0);

  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today);
  const todayFees = todayOrders.reduce((s, o) => s + o.platform_fee, 0);

  const stats = [
    { label: 'Comércios Ativos', value: activeTenants.length, icon: <Store className="h-5 w-5" />, sub: `${tenants.length} total` },
    { label: 'Total Pedidos', value: orders.length, icon: <ShoppingBag className="h-5 w-5" />, sub: `${todayOrders.length} hoje` },
    { label: 'Receita Plataforma', value: `R$${totalPlatformFees.toFixed(2)}`, icon: <DollarSign className="h-5 w-5" />, sub: `R$${todayFees.toFixed(2)} hoje` },
    { label: 'Faturamento Total', value: `R$${totalRevenue.toFixed(2)}`, icon: <TrendingUp className="h-5 w-5" />, sub: 'todos os comércios' },
  ];

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4 glow-primary">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">{s.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h3 className="font-heading text-lg text-foreground mt-6">Comércios Recentes</h3>
      <div className="space-y-2">
        {tenants.slice(0, 5).map(t => (
          <div key={t.id} className="flex items-center justify-between rounded-lg bg-secondary p-3 text-sm">
            <div className="flex items-center gap-3">
              {t.logo_url ? (
                <img src={t.logo_url} alt="" className="h-8 w-8 rounded-md object-cover" />
              ) : (
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                  <Store className="h-4 w-4 text-primary" />
                </div>
              )}
              <div>
                <span className="font-medium text-foreground">{t.name}</span>
                <p className="text-xs text-muted-foreground">/{t.slug} · {t.active ? '🟢 Ativo' : '🔴 Inativo'}</p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">Modo {t.delivery_mode}</span>
          </div>
        ))}
        {tenants.length === 0 && <p className="text-center text-muted-foreground py-4">Nenhum comércio cadastrado.</p>}
      </div>
    </div>
  );
};

export default SuperAdminDashboard;
