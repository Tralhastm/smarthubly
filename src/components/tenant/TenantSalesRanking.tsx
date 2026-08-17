import { useOrders, type OrderWithItems } from '@/hooks/useOrders';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useMemo } from 'react';

const TenantSalesRanking = ({ tenantId }: { tenantId: string }) => {
  const { data: orders = [], isLoading } = useOrders(tenantId);

  const ranking = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    orders.forEach(o => {
      (o as OrderWithItems).order_items?.forEach(item => {
        if (!map[item.product_name]) map[item.product_name] = { name: item.product_name, qty: 0, revenue: 0 };
        map[item.product_name].qty += item.quantity;
        map[item.product_name].revenue += item.product_price * item.quantity;
      });
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [orders]);

  if (isLoading) return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  if (ranking.length === 0) return <p className="text-center text-muted-foreground py-8">Nenhuma venda registrada.</p>;

  return (
    <div className="space-y-3">
      <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" /> Mais vendidos
      </h3>
      {ranking.slice(0, 5).map((p, i) => (
        <div key={p.name} className="flex items-center justify-between rounded-lg bg-secondary p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-primary w-5">{i + 1}º</span>
            <span className="font-medium text-foreground">{p.name}</span>
          </div>
          <div className="text-right">
            <span className="text-foreground font-medium">{p.qty} un.</span>
            <span className="text-muted-foreground ml-2">R${p.revenue.toFixed(2)}</span>
          </div>
        </div>
      ))}

      {ranking.length > 1 && (
        <>
          <h3 className="font-heading text-sm text-foreground flex items-center gap-2 mt-4">
            <TrendingDown className="h-4 w-4 text-destructive" /> Menos vendidos
          </h3>
          {ranking.slice(-3).reverse().map((p, i) => (
            <div key={p.name} className="flex items-center justify-between rounded-lg bg-secondary p-3 text-sm">
              <span className="font-medium text-foreground">{p.name}</span>
              <div className="text-right">
                <span className="text-foreground font-medium">{p.qty} un.</span>
                <span className="text-muted-foreground ml-2">R${p.revenue.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default TenantSalesRanking;
