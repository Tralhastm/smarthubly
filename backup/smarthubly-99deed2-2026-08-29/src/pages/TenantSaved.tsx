import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTenantBySlug } from '@/hooks/useTenants';
import { getSavedProducts, removeSaved, trackAffiliateClick, type SavedAffiliateProduct } from '@/lib/affiliate';
import { ArrowLeft, ExternalLink, Trash2, Heart, Store } from 'lucide-react';

const TenantSaved = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: tenant } = useTenantBySlug(slug);
  const [items, setItems] = useState<SavedAffiliateProduct[]>([]);

  useEffect(() => {
    const all = getSavedProducts();
    setItems(slug ? all.filter(i => i.tenantSlug === slug) : all);
  }, [slug]);

  const handleRemove = (id: string) => {
    removeSaved(id);
    setItems(prev => prev.filter(i => i.productId !== id));
  };

  const handleOpen = (item: SavedAffiliateProduct) => {
    if (!item.affiliateUrl) return;
    trackAffiliateClick({ productId: item.productId, tenantId: item.tenantId });
    window.open(item.affiliateUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="" width={36} height={36} className="rounded-md object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-md gradient-primary flex items-center justify-center">
                <Store className="h-5 w-5 text-primary-foreground" />
              </div>
            )}
            <h1 className="font-heading text-lg text-foreground">Minhas compras</h1>
          </div>
          <Link to={`/loja/${slug}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 pb-24">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <Heart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-1">Nada salvo ainda</p>
            <p className="text-sm text-muted-foreground mb-4">Toque no coração ou em "Comprar" pra salvar produtos aqui.</p>
            <Link to={`/loja/${slug}`} className="inline-flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium">
              Ver produtos
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(item => (
              <div key={item.productId} className="rounded-lg border border-border bg-card p-3 flex gap-3">
                <div className="w-20 h-20 rounded-md bg-secondary overflow-hidden flex-shrink-0">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-foreground line-clamp-2">{item.name}</h3>
                  <p className="text-primary font-bold text-sm mt-1">R${item.price.toFixed(2)}</p>
                  <div className="flex gap-2 mt-2">
                    {item.affiliateUrl && (
                      <button onClick={() => handleOpen(item)}
                        className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-xs font-medium hover:opacity-90">
                        <ExternalLink className="h-3 w-3" /> Abrir
                      </button>
                    )}
                    <button onClick={() => handleRemove(item.productId)}
                      className="flex items-center gap-1 rounded-md bg-secondary text-muted-foreground px-2 py-1 text-xs hover:text-destructive">
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default TenantSaved;
