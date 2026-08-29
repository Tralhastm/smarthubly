import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MousePointerClick, TrendingDown } from 'lucide-react';

type Row = { product_id: string; name: string; image: string; affiliate_url: string | null; clicks: number };

const TenantAffiliateClicksRanking = ({ tenantId }: { tenantId: string }) => {
  const [loading, setLoading] = useState(true);
  const [clicks, setClicks] = useState<{ product_id: string }[]>([]);
  const [products, setProducts] = useState<Record<string, { name: string; image: string; affiliate_url: string | null }>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from('affiliate_clicks').select('product_id').eq('tenant_id', tenantId).limit(10000),
        supabase.from('products').select('id, name, image, affiliate_url').eq('tenant_id', tenantId),
      ]);
      setClicks((c as any) || []);
      const map: Record<string, { name: string; image: string; affiliate_url: string | null }> = {};
      (p || []).forEach((prod: any) => { map[prod.id] = { name: prod.name, image: prod.image, affiliate_url: prod.affiliate_url }; });
      setProducts(map);
      setLoading(false);
    })();
  }, [tenantId]);

  const ranking: Row[] = useMemo(() => {
    const counts: Record<string, number> = {};
    clicks.forEach(c => { counts[c.product_id] = (counts[c.product_id] || 0) + 1; });
    // Include all products (even with zero clicks) so the "menos clicados" makes sense
    Object.keys(products).forEach(id => { if (!(id in counts)) counts[id] = 0; });
    return Object.entries(counts)
      .map(([product_id, clicks]) => ({
        product_id,
        clicks,
        name: products[product_id]?.name || 'Produto removido',
        image: products[product_id]?.image || '',
        affiliate_url: products[product_id]?.affiliate_url || null,
      }))
      .sort((a, b) => b.clicks - a.clicks);
  }, [clicks, products]);

  if (loading) return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (ranking.length === 0) return <p className="text-center text-muted-foreground py-8">Nenhum produto cadastrado.</p>;

  const top = ranking.slice(0, 10);
  const bottom = ranking.slice().reverse().slice(0, 5);

  const Item = ({ p, i, badgeClass }: { p: Row; i: number; badgeClass: string }) => (
    <div className="flex items-center gap-3 rounded-lg bg-secondary p-3">
      <span className={`text-xs font-bold w-6 text-center ${badgeClass}`}>{i + 1}º</span>
      {p.image ? (
        <img src={p.image} alt="" className="w-10 h-10 rounded-md object-cover border border-border" />
      ) : (
        <div className="w-10 h-10 rounded-md bg-muted" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
        {p.affiliate_url && <p className="text-xs text-muted-foreground truncate">{new URL(p.affiliate_url).hostname.replace('www.', '')}</p>}
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-foreground">{p.clicks}</p>
        <p className="text-[10px] text-muted-foreground uppercase">cliques</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-primary" /> Mais clicados
        </h3>
        <p className="text-xs text-muted-foreground">Produtos com mais cliques no botão "Comprar" — esses geram mais comissão pra você.</p>
        {top.map((p, i) => <Item key={p.product_id} p={p} i={i} badgeClass="text-primary" />)}
      </div>

      {ranking.length > 1 && (
        <div className="space-y-2">
          <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-destructive" /> Menos clicados
          </h3>
          <p className="text-xs text-muted-foreground">Considere remover, trocar a foto ou melhorar o título destes.</p>
          {bottom.map((p, i) => <Item key={p.product_id} p={p} i={i} badgeClass="text-destructive" />)}
        </div>
      )}
    </div>
  );
};

export default TenantAffiliateClicksRanking;
