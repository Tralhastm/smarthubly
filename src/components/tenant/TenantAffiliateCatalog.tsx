import { useState, useMemo, useEffect, useRef } from 'react';
import { useInfiniteProducts, type Product } from '@/hooks/useProducts';
import { Search, ExternalLink, Heart, Package, Loader2, X, Copy, Clock, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { saveProduct, trackAffiliateClick } from '@/lib/affiliate';
import { toast } from 'sonner';

const NETWORK_LABELS: Record<string, string> = {
  shopee: 'Shopee', amazon: 'Amazon', mercadolivre: 'Mercado Livre',
  aliexpress: 'AliExpress', magalu: 'Magalu', americanas: 'Americanas',
  hotmart: 'Hotmart', monetizze: 'Monetizze', eduzz: 'Eduzz', outro: 'Loja parceira',
};

const NetworkBadge = ({ net }: { net: string | null }) => {
  if (!net) return null;
  return (
    <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {NETWORK_LABELS[net] || net}
    </span>
  );
};

// Coupon helpers — returns active coupon info or null when expired/missing
type CouponInfo = {
  code: string;
  discountPrice: number;
  originalPrice: number;
  discountPercent: number;
  expiresAt: Date;
};

const getCouponInfo = (product: Product): CouponInfo | null => {
  const code = (product as any).affiliate_coupon_code as string | null;
  const discountPrice = (product as any).affiliate_coupon_discount_price as number | null;
  const expiresAtRaw = (product as any).affiliate_coupon_expires_at as string | null;
  if (!code || !discountPrice || !expiresAtRaw) return null;
  const expiresAt = new Date(expiresAtRaw);
  if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return null;
  if (discountPrice >= product.price) return null;
  return {
    code,
    discountPrice,
    originalPrice: product.price,
    discountPercent: Math.round((1 - discountPrice / product.price) * 100),
    expiresAt,
  };
};

const formatTimeLeft = (target: Date): string => {
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return 'Expirado';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
};

const useCountdown = (target: Date | null) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return '';
  return formatTimeLeft(target);
};

const CouponBadge = ({ coupon }: { coupon: CouponInfo }) => {
  const [copied, setCopied] = useState(false);
  const left = useCountdown(coupon.expiresAt);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      toast.success(`Cupom ${coupon.code} copiado!`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/10 p-2 mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <button onClick={copy}
          className="flex-1 flex items-center justify-between gap-2 rounded-md bg-background border border-dashed border-primary/60 px-2 py-1.5 hover:bg-primary/5 transition-colors min-w-0">
          <span className="font-mono text-xs font-bold text-primary truncate">{coupon.code}</span>
          {copied ? <Check className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <Copy className="h-3.5 w-3.5 text-primary shrink-0" />}
        </button>
        <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 shrink-0">
          -{coupon.discountPercent}%
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>Expira em <span className="font-semibold text-foreground">{left}</span></span>
      </div>
    </div>
  );
};

const PriceBlock = ({ product, coupon, size = 'card' }: {
  product: Product; coupon: CouponInfo | null; size?: 'card' | 'detail';
}) => {
  if (!coupon) {
    return (
      <span className={size === 'detail' ? 'text-3xl font-bold text-primary' : 'text-xl font-bold text-primary whitespace-nowrap'}>
        R${product.price.toFixed(2)}
      </span>
    );
  }
  return (
    <div className="flex flex-col">
      <span className={size === 'detail' ? 'text-xs text-muted-foreground line-through' : 'text-[10px] text-muted-foreground line-through'}>
        De R${coupon.originalPrice.toFixed(2)}
      </span>
      <span className={size === 'detail' ? 'text-3xl font-bold text-primary' : 'text-xl font-bold text-primary whitespace-nowrap'}>
        R${coupon.discountPrice.toFixed(2)}
      </span>
      <span className="text-[10px] text-primary/80">com cupom</span>
    </div>
  );
};

const Card = ({ product, tenantId, tenantSlug, index, onOpen }: {
  product: Product; tenantId: string; tenantSlug: string; index: number;
  onOpen: (p: Product) => void;
}) => {
  const url = (product as any).affiliate_url as string | null;
  const network = (product as any).affiliate_network as string | null;
  const coupon = getCouponInfo(product);

  const handleBuy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) { toast.error('Link de afiliado não configurado'); return; }
    if (coupon) {
      // Copy coupon then open store
      navigator.clipboard.writeText(coupon.code).catch(() => {});
      toast.success(`Cupom ${coupon.code} copiado! Cole no checkout da loja.`);
    }
    saveProduct({
      productId: product.id, tenantId, tenantSlug, name: product.name,
      image: product.image, price: coupon ? coupon.discountPrice : product.price,
      affiliateUrl: url, network, savedAt: new Date().toISOString(),
    });
    trackAffiliateClick({ productId: product.id, tenantId });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    saveProduct({
      productId: product.id, tenantId, tenantSlug, name: product.name,
      image: product.image, price: coupon ? coupon.discountPrice : product.price,
      affiliateUrl: url || '', network, savedAt: new Date().toISOString(),
    });
    toast.success('Salvo em "Minhas compras"');
  };

  return (
    <div className="animate-fade-in" style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
      <div onClick={() => onOpen(product)}
        className={`group relative overflow-hidden rounded-lg border bg-card p-4 hover-glow transition-all duration-300 cursor-pointer ${coupon ? 'border-primary/40 shadow-lg shadow-primary/5' : 'border-border hover:border-primary/30'}`}>
        <div className="aspect-square mb-3 overflow-hidden rounded-md bg-secondary flex items-center justify-center relative">
          {product.image ? (
            <img src={product.image} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
          ) : (
            <Package className="h-16 w-16 text-primary/40" />
          )}
          {coupon && (
            <span className="absolute top-2 left-2 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 shadow-md">
              CUPOM -{coupon.discountPercent}%
            </span>
          )}
          <button onClick={handleSave} aria-label="Salvar"
            className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white/80 hover:text-red-400 transition-colors">
            <Heart className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{product.category}</span>
          <NetworkBadge net={network} />
        </div>
        <h3 className="font-heading text-base text-foreground line-clamp-2">{product.name}</h3>
        {product.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{product.description}</p>}
        {coupon && <CouponBadge coupon={coupon} />}
        <div className="flex items-end justify-between mt-3 gap-2">
          <PriceBlock product={product} coupon={coupon} />
          <button onClick={handleBuy} disabled={!url}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium gradient-primary text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:opacity-40">
            <ExternalLink className="h-4 w-4" /> Comprar
          </button>
        </div>
      </div>
    </div>
  );
};

const ProductDetailModal = ({ product, tenantId, tenantSlug, onClose }: {
  product: Product; tenantId: string; tenantSlug: string; onClose: () => void;
}) => {
  const url = (product as any).affiliate_url as string | null;
  const network = (product as any).affiliate_network as string | null;
  const coupon = getCouponInfo(product);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const handleBuy = () => {
    if (!url) { toast.error('Link de afiliado não configurado'); return; }
    if (coupon) {
      navigator.clipboard.writeText(coupon.code).catch(() => {});
      toast.success(`Cupom ${coupon.code} copiado! Cole no checkout.`);
    }
    saveProduct({
      productId: product.id, tenantId, tenantSlug, name: product.name,
      image: product.image, price: coupon ? coupon.discountPrice : product.price,
      affiliateUrl: url, network, savedAt: new Date().toISOString(),
    });
    trackAffiliateClick({ productId: product.id, tenantId });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSave = () => {
    saveProduct({
      productId: product.id, tenantId, tenantSlug, name: product.name,
      image: product.image, price: coupon ? coupon.discountPrice : product.price,
      affiliateUrl: url || '', network, savedAt: new Date().toISOString(),
    });
    toast.success('Salvo em "Minhas compras"');
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-sm animate-fade-in overflow-y-auto" onClick={onClose}>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <button onClick={onClose}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors">
          <X className="h-5 w-5" aria-label="Fechar" />
        </button>
        <span className="text-xs text-muted-foreground truncate">Detalhes do produto</span>
      </div>
      <div className="flex-1 flex items-start justify-center p-4 sm:p-6 pb-32">
      <div className="relative w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="aspect-square sm:aspect-video overflow-hidden bg-secondary flex items-center justify-center relative">
          {product.image ? (
            <img src={product.image} alt={product.name} className="h-full w-full object-contain" />
          ) : (
            <Package className="h-24 w-24 text-primary/40" />
          )}
          {coupon && (
            <span className="absolute top-3 left-3 rounded-full bg-primary text-primary-foreground text-xs font-bold px-3 py-1 shadow-lg">
              🎟️ CUPOM -{coupon.discountPercent}%
            </span>
          )}
        </div>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{product.category}</span>
            <NetworkBadge net={network} />
          </div>
          <h2 className="font-heading text-2xl text-foreground mb-3">{product.name}</h2>
          {product.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed mb-4">
              {product.description}
            </p>
          )}
          {coupon && <CouponBadge coupon={coupon} />}
          <div className="flex items-end justify-between gap-3 pt-4 border-t border-border mt-4">
            <PriceBlock product={product} coupon={coupon} size="detail" />
            <div className="flex gap-2">
              <button onClick={handleSave} aria-label="Salvar"
                className="rounded-lg border border-border bg-secondary p-2.5 text-muted-foreground hover:text-red-400 transition-colors">
                <Heart className="h-5 w-5" />
              </button>
              <button onClick={handleBuy} disabled={!url}
                className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium gradient-primary text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:opacity-40">
                <ExternalLink className="h-4 w-4" /> {coupon ? 'Copiar cupom e ir à loja' : 'Comprar agora'}
              </button>
            </div>
          </div>
        </div>
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

const TenantAffiliateCatalog = ({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) => {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteProducts(tenantId);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [onlyCoupons, setOnlyCoupons] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const allProducts = useMemo(() => data?.pages.flatMap(p => p.data) ?? [], [data]);
  const couponCount = useMemo(() => allProducts.filter(p => getCouponInfo(p)).length, [allProducts]);
  const categories = useMemo(() => ['Todos', ...Array.from(new Set(allProducts.map(p => p.category)))], [allProducts]);
  const filtered = useMemo(() => allProducts.filter(p => {
    const ms = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const mc = activeCategory === 'Todos' || p.category === activeCategory;
    const mco = !onlyCoupons || getCouponInfo(p);
    return ms && mc && mco;
  }), [allProducts, search, activeCategory, onlyCoupons]);

  useEffect(() => {
    if (!sentinelRef.current || !hasNextPage) return;
    const obs = new IntersectionObserver(
      (e) => { if (e[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { rootMargin: '400px' },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
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
        {couponCount > 0 && (
          <button onClick={() => setOnlyCoupons(v => !v)}
            className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all flex items-center gap-2 ${onlyCoupons ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-primary/10'}`}>
            🎟️ Só com cupom <span className="text-[10px] opacity-80">({couponCount})</span>
          </button>
        )}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((p, i) => <Card key={p.id} product={p} tenantId={tenantId} tenantSlug={tenantSlug} index={i} onOpen={setSelected} />)}
      </div>
      <div ref={sentinelRef} className="h-1" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      )}
      {filtered.length === 0 && !isFetchingNextPage && (
        <p className="text-center text-muted-foreground py-12">Nenhum produto encontrado.</p>
      )}
      {selected && (
        <ProductDetailModal product={selected} tenantId={tenantId} tenantSlug={tenantSlug} onClose={() => setSelected(null)} />
      )}
    </div>
  );
};

export default TenantAffiliateCatalog;
