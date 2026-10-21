import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MousePointerClick, RotateCcw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function TenantProductClicksSummary({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['tenant-product-clicks-summary', tenantId],
    queryFn: async () => {
      const [{ data: products, error: productsError }, { data: clicks, error: clicksError }] = await Promise.all([
        supabase.from('products').select('id, name').eq('tenant_id', tenantId),
        supabase.from('affiliate_clicks').select('product_id, clicked_at').eq('tenant_id', tenantId).is('ip_hash', null).order('clicked_at', { ascending: false }).limit(10000),
      ]);
      if (productsError) throw productsError;
      if (clicksError) throw clicksError;
      return { products: products || [], clicks: clicks || [] };
    },
    staleTime: 30_000,
  });

  const resetClicks = useMutation({
    mutationFn: async () => {
      const { data: deleted, error } = await supabase.rpc(
        'reset_storefront_product_clicks' as any,
        { _tenant_id: tenantId } as any,
      );
      if (error) throw error;
      return Number(deleted) || 0;
    },
    onSuccess: async (deleted) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tenant-product-clicks-summary', tenantId] }),
        queryClient.invalidateQueries({ queryKey: ['affiliate-dashboard', tenantId] }),
      ]);
      toast.success(deleted === 0 ? 'Não havia cliques da vitrine para zerar.' : `${deleted} clique${deleted === 1 ? '' : 's'} da vitrine zerado${deleted === 1 ? '' : 's'}.`);
    },
    onError: () => toast.error('Não foi possível zerar os cliques. Confira o acesso de administrador e tente novamente.'),
  });

  const confirmReset = () => {
    if (!data?.clicks.length || resetClicks.isPending) return;
    const confirmed = window.confirm('Zerar os cliques de abertura dos detalhes de produto desta loja? Esta ação não pode ser desfeita e não apaga cliques externos de afiliados.');
    if (confirmed) resetClicks.mutate();
  };

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
        <div className="flex flex-wrap items-center gap-2 text-center">
          <div className="rounded-md bg-card px-3 py-2"><strong className="block text-lg text-primary">{data.clicks.length}</strong><span className="text-[10px] text-muted-foreground">total</span></div>
          <div className="rounded-md bg-card px-3 py-2"><strong className="block text-lg text-primary">{todayClicks}</strong><span className="text-[10px] text-muted-foreground">hoje</span></div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={confirmReset}
            disabled={data.clicks.length === 0 || resetClicks.isPending}
            aria-label="Zerar cliques de abertura de produto desta loja"
            className="h-9 border-destructive/30 px-3 text-xs text-destructive hover:text-destructive"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${resetClicks.isPending ? 'animate-spin' : ''}`} />
            {resetClicks.isPending ? 'Zerando…' : 'Zerar cliques'}
          </Button>
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
