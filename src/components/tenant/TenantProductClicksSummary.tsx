import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MousePointerClick, TrendingUp } from 'lucide-react';

export default function TenantProductClicksSummary({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tenant-product-clicks-summary', tenantId],
    queryFn: async () => {
      const [{ data: products, error: productsError }, { data: clicks, error: clicksError }] = await Promise.all([
        supabase.from('products').select('id, name').eq('tenant_id', tenantId),
        supabase.from('affiliate_clicks').select('product_id, clicked_at').eq('tenant_id', tenantId).order('clicked_at', { ascending: false }).limit(10000),
      ]);
      if (productsError) throw productsError;
      if (clicksError) throw clicksError;
      return { products: products || [], clicks: clicks || [] };
    },
    staleTime: 30_000,
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-lg border border-border bg-secondary/40" />;
  if (!data) return null;

  const today = new Date().toDateString();
  const todayClicks = data.clicks.filter(click => new Date(click.clicked_at).toDateString() === today).length;
  const counts = new Map<string, number>();
  data.clicks.forEach(click => counts.set(click.product_id, (counts.get(click.product_id) || 0) + 1));
  const top = data.products
    .map(product => ({ ...product, clicks: counts.get(product.id) || 0 }))
    .filter(product => product.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);

  return (
    <section aria-label="Cliques da vitrine" className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MousePointerClick className="h-4 w-4 text-primary" /> Cliques da vitrine
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Registra quando um cliente abre o detalhe de um produto.</p>
        </div>
        <div className="flex gap-2 text-center">
          <div className="rounded-md bg-card px-3 py-2"><strong className="block text-lg text-primary">{data.clicks.length}</strong><span className="text-[10px] text-muted-foreground">total</span></div>
          <div className="rounded-md bg-card px-3 py-2"><strong className="block text-lg text-primary">{todayClicks}</strong><span className="text-[10px] text-muted-foreground">hoje</span></div>
        </div>
      </div>
      {top.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {top.map((product, index) => (
            <div key={product.id} className="flex min-w-0 items-center gap-2 rounded-md bg-card px-2.5 py-2">
              <span className="text-xs font-bold text-primary">{index + 1}º</span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={product.name}>{product.name}</span>
              <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary"><TrendingUp className="h-3 w-3" />{product.clicks}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Ainda não há cliques registrados. Abra a vitrine e teste um produto para começar.</p>
      )}
    </section>
  );
}
