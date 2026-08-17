import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MousePointerClick, Package, TrendingUp, Calendar, Target, AlertCircle } from 'lucide-react';

const NETWORK_LABELS: Record<string, string> = {
  shopee: 'Shopee', amazon: 'Amazon', mercadolivre: 'Mercado Livre',
  aliexpress: 'AliExpress', magalu: 'Magalu', americanas: 'Americanas',
  hotmart: 'Hotmart', monetizze: 'Monetizze', eduzz: 'Eduzz', outro: 'Loja parceira',
};

const TenantAffiliateDashboard = ({ tenantId }: { tenantId: string }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['affiliate-dashboard', tenantId],
    queryFn: async () => {
      const [productsRes, clicksRes] = await Promise.all([
        supabase.from('products').select('id, name, image, category, affiliate_network, created_at').eq('tenant_id', tenantId),
        supabase.from('affiliate_clicks').select('product_id, clicked_at').eq('tenant_id', tenantId),
      ]);
      return {
        products: productsRes.data || [],
        clicks: clicksRes.data || [],
      };
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const products = data?.products || [];
  const clicks = data?.clicks || [];
  const today = new Date().toDateString();
  const thisMonth = new Date().getMonth();
  const thisYear = new Date().getFullYear();

  const todayClicks = clicks.filter(c => new Date(c.clicked_at).toDateString() === today).length;
  const monthClicks = clicks.filter(c => {
    const d = new Date(c.clicked_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  // Count clicks per product
  const clicksByProduct = new Map<string, number>();
  clicks.forEach(c => clicksByProduct.set(c.product_id, (clicksByProduct.get(c.product_id) || 0) + 1));

  const productsWithClicks = products.map(p => ({
    ...p,
    clickCount: clicksByProduct.get(p.id) || 0,
  }));

  const topProducts = [...productsWithClicks].sort((a, b) => b.clickCount - a.clickCount).slice(0, 5);
  const noClickProducts = productsWithClicks.filter(p => p.clickCount === 0);
  const ctr = products.length > 0 ? (clicks.length / products.length).toFixed(1) : '0';

  // Network distribution
  const byNetwork = new Map<string, number>();
  products.forEach(p => {
    const n = (p as any).affiliate_network || 'outro';
    byNetwork.set(n, (byNetwork.get(n) || 0) + 1);
  });

  const stats = [
    { label: 'Cliques Hoje', value: todayClicks, icon: <MousePointerClick className="h-5 w-5" />, sub: `${monthClicks} no mês` },
    { label: 'Cliques Totais', value: clicks.length, icon: <TrendingUp className="h-5 w-5" />, sub: 'desde o início' },
    { label: 'Produtos Cadastrados', value: products.length, icon: <Package className="h-5 w-5" />, sub: `${products.length - noClickProducts.length} com cliques` },
    { label: 'Média por Produto', value: ctr, icon: <Target className="h-5 w-5" />, sub: 'cliques/produto' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4 glow-primary">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">{s.icon}</div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground truncate">{s.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {byNetwork.size > 0 && (
        <div>
          <h3 className="font-heading text-lg text-foreground mb-3 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" /> Produtos por rede
          </h3>
          <div className="flex flex-wrap gap-2">
            {Array.from(byNetwork.entries()).map(([net, count]) => (
              <span key={net} className="rounded-full bg-secondary px-3 py-1.5 text-sm text-foreground">
                {NETWORK_LABELS[net] || net} <span className="text-muted-foreground ml-1">({count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-heading text-lg text-foreground mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-green-500" /> Top 5 mais clicados
        </h3>
        {topProducts.length === 0 || topProducts[0].clickCount === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center bg-secondary rounded-lg">
            Nenhum clique registrado ainda. Compartilhe sua loja!
          </p>
        ) : (
          <div className="space-y-2">
            {topProducts.filter(p => p.clickCount > 0).map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg bg-secondary p-3">
                <span className="font-bold text-primary w-6 text-center">{i + 1}</span>
                {p.image ? (
                  <img src={p.image} alt={p.name} className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-card flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.category}</p>
                </div>
                <span className="text-sm font-bold text-primary whitespace-nowrap">{p.clickCount} {p.clickCount === 1 ? 'clique' : 'cliques'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {noClickProducts.length > 0 && (
        <div>
          <h3 className="font-heading text-lg text-foreground mb-3 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-500" /> Produtos sem cliques ({noClickProducts.length})
          </h3>
          <p className="text-xs text-muted-foreground mb-2">Considere remover, melhorar a foto ou o título destes:</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {noClickProducts.slice(0, 10).map(p => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg bg-secondary/50 p-2.5">
                {p.image ? (
                  <img src={p.image} alt={p.name} className="h-8 w-8 rounded object-cover opacity-60" />
                ) : (
                  <div className="h-8 w-8 rounded bg-card flex items-center justify-center"><Package className="h-4 w-4 text-muted-foreground" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-muted-foreground truncate">{p.name}</p>
                </div>
              </div>
            ))}
            {noClickProducts.length > 10 && (
              <p className="text-xs text-center text-muted-foreground py-2">+ {noClickProducts.length - 10} produtos</p>
            )}
          </div>
        </div>
      )}

      {products.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium mb-1">Nenhum produto cadastrado ainda</p>
          <p className="text-sm text-muted-foreground">Vá para a aba <strong>Produtos</strong> e importe seu primeiro link de afiliado.</p>
        </div>
      )}
    </div>
  );
};

export default TenantAffiliateDashboard;
