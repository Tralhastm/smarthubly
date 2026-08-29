import { useTenants } from '@/hooks/useTenants';
import { useAllOrders } from '@/hooks/useOrders';
import { Store, DollarSign, Wallet } from 'lucide-react';

const SuperAdminMetrics = () => {
  const { data: tenants = [] } = useTenants();
  const { data: orders = [], isLoading } = useAllOrders({ refetchInterval: 30000 });

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  const tenantMetrics = tenants.map(t => {
    const tenantOrders = orders.filter(o => o.tenant_id === t.id);
    const revenue = tenantOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const fees = tenantOrders.reduce((s, o) => s + (Number(o.platform_fee) || 0), 0);
    const isDonated = (t as any).is_donated ?? false;
    return { ...t, orderCount: tenantOrders.length, revenue, fees, isDonated };
  }).sort((a, b) => b.revenue - a.revenue);

  const totalFees = tenantMetrics
    .filter(t => !t.isDonated)
    .reduce((s, t) => s + t.fees, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4 glow-primary">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><DollarSign className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Meu Lucro Total</p>
              <p className="text-2xl font-bold text-green-500">R${totalFees.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">{orders.length} pedidos em {tenants.length} comércios</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 glow-primary">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Wallet className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Comércios Doados</p>
              <p className="text-2xl font-bold text-foreground">{tenantMetrics.filter(t => t.isDonated).length}</p>
              <p className="text-xs text-muted-foreground">sem cobrança de taxa</p>
            </div>
          </div>
        </div>
      </div>

      <h3 className="font-heading text-lg text-foreground">Quanto cada lojista me deve</h3>
      <div className="space-y-2">
        {tenantMetrics.filter(t => !t.isDonated && t.fees > 0).map(t => (
          <div key={t.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {t.logo_url ? (
                  <img src={t.logo_url} alt="" className="h-8 w-8 rounded-md object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                    <Store className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div>
                  <p className="font-medium text-foreground text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.orderCount} pedidos · Faturou R${t.revenue.toFixed(2)}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-destructive text-sm">Me deve: R${t.fees.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Sobra p/ ele: R${(t.revenue - t.fees).toFixed(2)}</p>
              </div>
            </div>
          </div>
        ))}
        {tenantMetrics.filter(t => !t.isDonated && t.fees > 0).length === 0 && (
          <p className="text-center text-muted-foreground py-4">Nenhum lojista com taxa pendente.</p>
        )}
      </div>

      <h3 className="font-heading text-lg text-foreground">Todos os Comércios</h3>
      <div className="space-y-2">
        {tenantMetrics.map(t => (
          <div key={t.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {t.logo_url ? (
                  <img src={t.logo_url} alt="" className="h-8 w-8 rounded-md object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                    <Store className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div>
                  <p className="font-medium text-foreground text-sm">{t.name} {t.isDonated && '🎁'}</p>
                  <p className="text-xs text-muted-foreground">{t.orderCount} pedidos · {t.active ? '🟢' : '🔴'}{t.isDonated ? ' · Doada' : ''}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-foreground text-sm">R${t.revenue.toFixed(2)}</p>
                <p className="text-xs text-primary">Taxa: R${t.fees.toFixed(2)}{t.isDonated ? ' (doada)' : ''}</p>
              </div>
            </div>
            {t.revenue > 0 && (
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full gradient-primary" style={{ width: `${Math.min(100, (t.revenue / Math.max(tenantMetrics[0]?.revenue || 1, 1)) * 100)}%` }} />
              </div>
            )}
          </div>
        ))}
        {tenantMetrics.length === 0 && <p className="text-center text-muted-foreground py-4">Nenhum comércio cadastrado.</p>}
      </div>
    </div>
  );
};

export default SuperAdminMetrics;
