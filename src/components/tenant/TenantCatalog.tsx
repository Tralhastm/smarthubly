import { useState, useEffect, useRef, useMemo } from 'react';
import { useInfiniteProducts, type Product } from '@/hooks/useProducts';
import { useCart } from '@/contexts/CartContext';
import { supabase } from '@/integrations/supabase/client';
import { Search, ShoppingCart, Package, Loader2, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import SupplierChatCustomer from './SupplierChatCustomer';
import ProductOptionsPicker from './ProductOptionsPicker';
import MediaCarousel from '@/components/shared/MediaCarousel';
import { Skeleton } from '@/components/ui/skeleton';
import { getItemCTA } from '@/lib/niche-labels';

export type CatalogLayout = 'grid' | 'list' | 'compact' | 'magazine';

const isAiGeneratedImage = (url: string) => {
  if (!url) return false;
  return url.includes('ai=1') || (url.includes('/product-images/') && url.endsWith('.png'));
};

// ============================================================
// GRID — card grande com imagem grande (padrão atual)
// ============================================================
const GridCard = ({ product, index, tenantId, addToCart, isDropshipping, niche, hasExtras, onOpenPicker, onOpenDetails }: any) => {
  const isService = (product as any).item_type === 'service';
  const cta = getItemCTA(product as any, niche);
  const Icon = isService ? Calendar : ShoppingCart;
  const [expanded, setExpanded] = useState(false);
  const desc = product.description || '';
  const isLongDesc = desc.length > 90;
  return (
    <div className="animate-fade-in" style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
      <div className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card p-4 hover-glow transition-all duration-300 hover:border-primary/30" onClick={() => onOpenDetails(product)}>
        <div className="aspect-square mb-3 overflow-hidden rounded-md bg-secondary flex items-center justify-center relative">
          {Array.isArray(product.media) && product.media.length > 0 ? (
            <MediaCarousel items={product.media} className="h-full w-full" imgClassName="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" videoClassName="h-full w-full object-cover" />
          ) : product.image ? (
            <>
              <img src={product.image} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
              {isAiGeneratedImage(product.image) && (
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/70 leading-none select-none">Foto gerada por IA</span>
              )}
            </>
          ) : (<Package className="h-16 w-16 text-primary/40" />)}
        </div>
        {!product.in_stock && (
          <span className="absolute top-6 right-6 rounded-full bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground">Esgotado</span>
        )}
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{product.category}</span>
        <h3 className="font-heading text-lg mt-1 text-foreground">{product.name}</h3>
        {desc && (
          <p className={`text-sm text-muted-foreground mt-1 whitespace-pre-line ${expanded ? '' : 'line-clamp-2'}`}>{desc}</p>
        )}
        {isLongDesc && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {expanded ? <>Ver menos <ChevronUp className="h-3 w-3" /></> : <>Ver mais <ChevronDown className="h-3 w-3" /></>}
          </button>
        )}
        <div className="flex items-center justify-between mt-4">
          <span className="text-xl font-bold text-primary">R${product.price.toFixed(2)}</span>
          {(product as any).stock_quantity != null && (product as any).stock_quantity <= 5 && product.in_stock && (
            <span className="text-xs text-yellow-400">Restam {(product as any).stock_quantity}</span>
          )}
          <div className="flex items-center gap-2">
            {isDropshipping && product.supplier_id && (
              <SupplierChatCustomer tenantId={tenantId} productId={product.id} supplierId={product.supplier_id} productName={product.name} />
            )}
            <button onClick={(e) => {
                e.stopPropagation();
                if (!product.in_stock) return;
                if (hasExtras) onOpenPicker(product); else addToCart(product);
              }} disabled={!product.in_stock}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium gradient-primary text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
              <Icon className="h-4 w-4" /> {hasExtras ? 'Personalizar' : cta}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// LIST — linha horizontal (estilo iFood/Anota AI), foto à esquerda
// ============================================================
const ListRow = ({ product, tenantId, addToCart, isDropshipping, niche, hasExtras, onOpenPicker, onOpenDetails }: any) => {
  const cta = getItemCTA(product as any, niche);
  return (
    <div className="group flex gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/30 transition-colors animate-fade-in" onClick={() => onOpenDetails && onOpenDetails(product)} style={onOpenDetails ? { cursor: 'pointer' } : undefined}>
      <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 overflow-hidden rounded-md bg-secondary flex items-center justify-center relative">
        {Array.isArray(product.media) && product.media.length > 0 ? (
          <MediaCarousel items={product.media} className="h-full w-full" imgClassName="h-full w-full object-cover" videoClassName="h-full w-full object-cover" />
        ) : product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (<Package className="h-10 w-10 text-primary/40" />)}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{product.category}</span>
            <h3 className="font-heading text-base text-foreground truncate">{product.name}{onOpenDetails && <span className="ml-1 text-primary/60">›</span>}</h3>
          </div>
          {!product.in_stock && (
            <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-medium text-destructive-foreground shrink-0">Esgotado</span>
          )}
        </div>
        {product.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.description}</p>
        )}
        <div className="flex items-end justify-between mt-auto pt-2">
          <span className="text-lg font-bold text-primary">R${product.price.toFixed(2)}</span>
          <div className="flex items-center gap-1.5">
            {isDropshipping && product.supplier_id && (
              <SupplierChatCustomer tenantId={tenantId} productId={product.id} supplierId={product.supplier_id} productName={product.name} />
            )}
            <button onClick={(e) => {
                e.stopPropagation();
                if (!product.in_stock) return;
                if (hasExtras) onOpenPicker(product); else addToCart(product);
              }} disabled={!product.in_stock}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium gradient-primary text-primary-foreground hover:opacity-90 disabled:opacity-40">
              <ShoppingCart className="h-3.5 w-3.5" /> {hasExtras ? 'Personalizar' : cta}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// COMPACT — sem foto grande, foco no nome+preço (estilo cardápio impresso)
// ============================================================
const CompactRow = ({ product, addToCart, niche, hasExtras, onOpenPicker, onOpenDetails }: any) => {
  const cta = getItemCTA(product as any, niche);
  return (
    <div className="group flex items-start justify-between gap-3 py-3 border-b border-border last:border-0 animate-fade-in" onClick={() => onOpenDetails && onOpenDetails(product)} style={onOpenDetails ? { cursor: 'pointer' } : undefined}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <h3 className="font-heading text-base text-foreground">{product.name}{onOpenDetails && <span className="ml-1 text-primary/60">›</span>}</h3>
          <div className="flex-1 border-b border-dashed border-border/60 self-end mb-1.5" />
          <span className="text-base font-bold text-primary shrink-0">R${product.price.toFixed(2)}</span>
        </div>
        {product.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 pr-2">{product.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {!product.in_stock ? (
            <span className="text-[10px] text-destructive">Esgotado</span>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); hasExtras ? onOpenPicker(product) : addToCart(product); }}
              className="text-xs font-medium text-primary hover:underline">
              + {hasExtras ? 'Personalizar' : cta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// MAGAZINE — bento grid: 1 destaque grande + cards menores
// ============================================================
const MagazineCard = ({ product, addToCart, niche, hasExtras, onOpenPicker, onOpenDetails, large }: any) => {
  const cta = getItemCTA(product as any, niche);
  return (
    <div className={`group relative overflow-hidden rounded-xl border border-border bg-card hover:border-primary/40 transition-all animate-fade-in ${large ? 'md:col-span-2 md:row-span-2' : ''}`} onClick={() => onOpenDetails && onOpenDetails(product)} style={onOpenDetails ? { cursor: 'pointer' } : undefined}>
      <div className={`overflow-hidden bg-secondary ${large ? 'aspect-[16/10]' : 'aspect-square'}`}>
        {Array.isArray(product.media) && product.media.length > 0 ? (
          <MediaCarousel items={product.media} className="h-full w-full" imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" videoClassName="h-full w-full object-cover" />
        ) : product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" decoding="async" />
        ) : (
          <div className="h-full w-full flex items-center justify-center"><Package className="h-12 w-12 text-primary/40" /></div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent">
        <span className="text-[10px] font-medium text-white/70 uppercase tracking-wider">{product.category}</span>
        <h3 className={`font-heading text-white ${large ? 'text-xl' : 'text-base'} leading-tight`}>{product.name}</h3>
        <div className="flex items-center justify-between mt-2">
          <span className={`font-bold text-white ${large ? 'text-2xl' : 'text-lg'}`}>R${product.price.toFixed(2)}</span>
          <button onClick={(e) => {
              e.stopPropagation();
              if (!product.in_stock) return;
              if (hasExtras) onOpenPicker(product); else addToCart(product);
            }} disabled={!product.in_stock}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium gradient-primary text-primary-foreground hover:opacity-90 disabled:opacity-40">
            <ShoppingCart className="h-3 w-3" /> {hasExtras ? 'Personalizar' : cta}
          </button>
        </div>
      </div>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="rounded-lg border border-border bg-card p-4">
    <Skeleton className="aspect-square mb-3 rounded-md" />
    <Skeleton className="h-3 w-16 mb-2" />
    <Skeleton className="h-5 w-3/4 mb-1" />
    <Skeleton className="h-4 w-full mb-4" />
    <div className="flex justify-between"><Skeleton className="h-6 w-20" /><Skeleton className="h-9 w-24 rounded-lg" /></div>
  </div>
);

const TenantCatalog = ({ tenantId, isDropshipping = false, niche, layout = 'grid', splashEnabled = true }: { tenantId: string; isDropshipping?: boolean; niche?: string | null; layout?: CatalogLayout; splashEnabled?: boolean }) => {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteProducts(tenantId);
  const { addToCart } = useCart();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [extrasIds, setExtrasIds] = useState<Set<string>>(new Set());
    const [detail, setDetail] = useState<Product | null>(null);
  const allProducts = useMemo(() => data?.pages.flatMap(p => p.data) ?? [], [data]);
  const openDetails = splashEnabled ? setDetail : null;

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const [v, a] = await Promise.all([
        supabase.from('product_variants' as any).select('product_id').eq('tenant_id', tenantId),
        supabase.from('product_addons' as any).select('product_id').eq('tenant_id', tenantId),
      ]);
      if (cancelled) return;
      const ids = new Set<string>();
      ((v.data as any[]) || []).forEach(r => ids.add(r.product_id));
      ((a.data as any[]) || []).forEach(r => ids.add(r.product_id));
      setExtrasIds(ids);
    })();
    return () => { cancelled = true; };
  }, [tenantId, allProducts.length]);

  const categories = useMemo(() => ['Todos', ...Array.from(new Set(allProducts.map(p => p.category)))], [allProducts]);

  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return allProducts.filter(p => {
      if (!q) return activeCategory === 'Todos' || p.category === activeCategory;
      const words = q.split(/\s+/).filter(Boolean);
      const haystack = normalize(`${p.name} ${p.description || ''} ${p.category || ''}`);
      const matchSearch = words.every(w => haystack.includes(w));
      const matchCategory = activeCategory === 'Todos' || p.category === activeCategory;
      return matchSearch && matchCategory;
    });
  }, [allProducts, search, activeCategory]);

  useEffect(() => {
    if (!sentinelRef.current || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { rootMargin: '400px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Agrupar por categoria nos layouts list/compact (mais legível como cardápio)
  // IMPORTANTE: este hook precisa ser chamado ANTES de qualquer return condicional
  const grouped = useMemo(() => {
    if (layout !== 'list' && layout !== 'compact') return null;
    const map = new Map<string, Product[]>();
    filtered.forEach(p => {
      const c = p.category || 'Outros';
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(p);
    });
    return Array.from(map.entries());
  }, [filtered, layout]);

  if (isLoading) {
    return (
      <div className="relative z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produtos..."
            className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 focus:border-primary/50 outline-none transition-all" />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide">
        {categories.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              activeCategory === cat ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}>
            {cat}
          </button>
        ))}
      </div>

      {layout === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((product, i) => (
            <GridCard key={product.id} product={product} index={i} tenantId={tenantId} addToCart={addToCart}
              isDropshipping={isDropshipping} niche={niche} hasExtras={extrasIds.has(product.id)} onOpenPicker={setPickerProduct} onOpenDetails={openDetails} />
          ))}
        </div>
      )}

      {layout === 'list' && grouped && (
        <div className="space-y-8">
          {grouped.map(([cat, items]) => (
            <section key={cat}>
              {activeCategory === 'Todos' && (
                <h2 className="font-heading text-lg text-foreground mb-3 pb-2 border-b border-border">{cat}</h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map(product => (
                  <ListRow key={product.id} product={product} tenantId={tenantId} addToCart={addToCart}
                    isDropshipping={isDropshipping} niche={niche} hasExtras={extrasIds.has(product.id)} onOpenPicker={setPickerProduct} onOpenDetails={openDetails} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {layout === 'compact' && grouped && (
        <div className="space-y-6 max-w-2xl mx-auto">
          {grouped.map(([cat, items]) => (
            <section key={cat} className="rounded-lg border border-border bg-card p-4">
              {activeCategory === 'Todos' && (
                <h2 className="font-heading text-base text-primary mb-2 uppercase tracking-wide">{cat}</h2>
              )}
              <div>
                {items.map(product => (
                  <CompactRow key={product.id} product={product} addToCart={addToCart} niche={niche}
                    hasExtras={extrasIds.has(product.id)} onOpenPicker={setPickerProduct} onOpenDetails={openDetails} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {layout === 'magazine' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 auto-rows-[140px] md:auto-rows-[180px]">
          {filtered.map((product, i) => (
            <MagazineCard key={product.id} product={product} addToCart={addToCart} niche={niche}
              hasExtras={extrasIds.has(product.id)} onOpenPicker={setPickerProduct} onOpenDetails={openDetails} large={i % 7 === 0} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-1" />

      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {filtered.length === 0 && !isFetchingNextPage && (
        <p className="text-center text-muted-foreground py-12">Nenhum produto encontrado.</p>
      )}

      {splashEnabled && detail && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:p-4 sm:items-center"
          onClick={() => setDetail(null)} role="dialog" aria-modal="true">
          <div className="slide-in-from-bottom w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl animate-in duration-300"
            onClick={(e) => e.stopPropagation()}>
            <div className="relative rounded-t-2xl bg-black">
              <MediaCarousel
                items={Array.isArray((detail as any).media) && (detail as any).media.length > 0
                  ? (detail as any).media
                  : (detail as any).image ? [{ kind: 'image', url: (detail as any).image, alt: detail.name }] : []}
                className="max-h-[45vh] w-full"
                imgClassName="max-h-[45vh] w-full object-contain"
                videoClassName="max-h-[45vh] w-full object-contain"
              />
              <button onClick={() => setDetail(null)} aria-label="Fechar"
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80">
                <ChevronDown className="h-5 w-5 rotate-45" />
              </button>
              {(detail as any).original_price != null && (detail as any).original_price > detail.price && (
                <span className="absolute left-3 top-3 rounded-full bg-destructive px-3 py-1 text-xs font-bold text-destructive-foreground">Promoção</span>
              )}
            </div>
            <div className="space-y-3 p-6 text-foreground">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{detail.category || 'Produto'}</span>
                <h2 className="font-heading text-2xl mt-1">{detail.name}</h2>
              </div>
              {detail.description && (
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{detail.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {(detail as any).original_price != null && (detail as any).original_price > detail.price && (
                  <span className="text-sm text-muted-foreground line-through">R${(detail as any).original_price.toFixed(2)}</span>
                )}
                <span className="text-2xl font-bold text-primary">R${detail.price.toFixed(2)}</span>
                {!detail.in_stock ? (
                  <span className="rounded-full bg-destructive/15 px-3 py-1 text-xs font-medium text-destructive">Esgotado</span>
                ) : (detail as any).stock_quantity != null && (detail as any).stock_quantity <= 5 ? (
                  <span className="rounded-full bg-yellow-400/15 px-3 py-1 text-xs font-medium text-yellow-500">Restam {(detail as any).stock_quantity}</span>
                ) : null}
              </div>
              <button onClick={() => { addToCart(detail); setDetail(null); }} disabled={!detail.in_stock}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-bold uppercase tracking-wider gradient-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40">
                <ShoppingCart className="h-5 w-5" />
                {detail.in_stock ? 'Adicionar ao carrinho' : 'Indisponível'}
              </button>
            </div>
          </div>
        </div>
      )}
      {pickerProduct && (
        <ProductOptionsPicker product={pickerProduct} onClose={() => setPickerProduct(null)} />
      )}
    </div>
  );
};

export default TenantCatalog;
