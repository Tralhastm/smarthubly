import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTenantBySlug } from '@/hooks/useTenants';
import { useStoreManifest } from '@/hooks/useStoreManifest';
import TenantCatalog from '@/components/tenant/TenantCatalog';
import TenantAffiliateCatalog from '@/components/tenant/TenantAffiliateCatalog';
import TenantCartDrawer from '@/components/tenant/TenantCartDrawer';
import StoreSplash from '@/components/tenant/StoreSplash';
import SupermarketStorefront from '@/components/tenant/SupermarketStorefront';
import StoreQuoteCalculator from '@/components/tenant/StoreQuoteCalculator';
import StoreChatbot from '@/components/tenant/StoreChatbot';
import { ClipboardList, Store, MessageCircle, Heart, Calculator, ShoppingBag } from 'lucide-react';
import { deriveBrandTokens, applyBrandTokens, clearBrandTokens } from '@/lib/color-utils';

const TenantStore = () => {
  const { slug } = useParams<{ slug: string }>();
  const [showSplash, setShowSplash] = useState(true);
  const [view, setView] = useState<'catalog' | 'quote'>('catalog');
  const hideSplash = useCallback(() => setShowSplash(false), []);
  const { data: tenant, isLoading } = useTenantBySlug(slug);
  // Per-store PWA manifest: instalar a loja mostra o nome+logo dela.
  useStoreManifest({
    slug: slug || '',
    startPath: `/loja/${slug}`,
    scopePath: `/loja/${slug}/`,
  });

  // Apply tenant brand colors with auto-derived tokens (garante contraste)
  useEffect(() => {
    if (!tenant) return;
    const primary = (tenant as any).brand_primary_color || '#3B82F6';
    const bg = (tenant as any).brand_bg_color || '#FFFFFF';
    const root = document.documentElement;
    const tokens = deriveBrandTokens(primary, bg);
    applyBrandTokens(root, tokens);
    // loja pública nunca herda .dark do painel admin
    root.classList.remove('dark');
    return () => clearBrandTokens(root, Object.keys(tokens));
  }, [tenant]);


  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Loja não encontrada</h1>
          <p className="text-muted-foreground">Este comércio não está disponível.</p>
          <a href="/" className="mt-4 inline-block text-sm text-primary hover:underline">← Voltar</a>
        </div>
      </div>
    );
  }

  if ((tenant as any).blocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🚫</div>
          <h1 className="text-xl font-bold text-foreground mb-2">Loja temporariamente indisponível</h1>
          <p className="text-muted-foreground text-sm">Esta loja está com o atendimento suspenso no momento. Tente novamente mais tarde.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {showSplash && (
        <StoreSplash
          logoUrl={tenant.logo_url}
          name={tenant.name}
          bgColor={(tenant as any).splash_bg_color || '#0F172A'}
          onDone={hideSplash}
        />
      )}
      {(tenant as any).store_mode !== 'supermarket' && (
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">

        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {tenant.logo_url ? (
              <img src={tenant.logo_url} alt={tenant.name} width={48} height={48} className="rounded-md object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-md gradient-primary flex items-center justify-center">
                <Store className="h-6 w-6 text-primary-foreground" />
              </div>
            )}
            <span className="font-heading text-lg text-foreground">{tenant.name}</span>
          </div>
          <nav className="flex items-center gap-4">
            <a href={`/loja/${slug}/chat`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
              <MessageCircle className="h-4 w-4" /> Chat
            </a>
            {(tenant as any).store_mode === 'affiliate' ? (
              <a href={`/loja/${slug}/salvos`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
                <Heart className="h-4 w-4" /> Salvos
              </a>
            ) : (
              <a href={`/loja/${slug}/meus-pedidos`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
                <ClipboardList className="h-4 w-4" /> Pedidos
              </a>
            )}
          </nav>
        </div>
      </header>
      )}



      {(tenant as any).store_mode === 'supermarket' ? (
        <SupermarketStorefront tenant={tenant} />
      ) : (
        <>
      <section className="relative py-12 overflow-hidden">
        <div className="container mx-auto px-4 text-center relative z-10">
          <h1 className="font-heading text-3xl md:text-4xl text-foreground mb-3">{tenant.name}</h1>
          {tenant.description && <p className="text-muted-foreground text-base max-w-xl mx-auto mb-6">{tenant.description}</p>}
          <div className="h-0.5 w-24 gradient-primary rounded-full mx-auto" />
        </div>
      </section>

      {(tenant as any).promo_active && (tenant as any).promo_text && (
        <section className="container mx-auto px-4 mb-6">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 animate-fade-in">
            <p className="text-sm font-bold text-primary mb-1">{(tenant as any).promo_title || 'Promoção do Dia'}</p>
            <p className="text-sm text-foreground">{(tenant as any).promo_text}</p>
          </div>
        </section>
      )}

      <main className="container mx-auto px-4 pb-24">
        {(tenant as any).quotes_enabled && (tenant as any).store_mode !== 'affiliate' && (
          <div className="flex gap-2 mb-5 border-b border-border">
            <button
              onClick={() => setView('catalog')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${view === 'catalog' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <ShoppingBag className="h-4 w-4" /> Catálogo
            </button>
            <button
              onClick={() => setView('quote')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${view === 'quote' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <Calculator className="h-4 w-4" /> Solicitar orçamento
            </button>
          </div>
        )}

        {view === 'quote' && (tenant as any).quotes_enabled ? (
          <StoreQuoteCalculator
            tenantId={tenant.id}
            tenantName={tenant.name}
            whatsapp={tenant.whatsapp}
            introText={(tenant as any).quotes_intro_text}
          />
        ) : (tenant as any).store_mode === 'affiliate' ? (
          <TenantAffiliateCatalog tenantId={tenant.id} tenantSlug={slug!} />
        ) : (
          <TenantCatalog tenantId={tenant.id} isDropshipping={tenant.is_dropshipping} niche={tenant.niche} layout={((tenant as any).catalog_layout as any) || 'grid'} splashEnabled={(tenant as any).product_splash_enabled !== false} />
        )}
      </main>
        </>
      )}

      {(tenant as any).store_mode !== 'affiliate' && view === 'catalog' && <TenantCartDrawer tenant={tenant} />}

      {tenant.whatsapp && (tenant as any).store_mode !== 'supermarket' && (
        <a href={`https://wa.me/${tenant.whatsapp}`} target="_blank" rel="noopener noreferrer"
          className="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 font-medium shadow-lg transition-colors bg-[hsl(142,71%,30%)] text-foreground hover:bg-[hsl(142,71%,35%)]">
          <MessageCircle className="h-5 w-5" />
          <span className="hidden sm:inline text-sm">Contato</span>
        </a>
      )}

      {/* Assistente IA do CLIENTE — personalizado por nicho, conhece o catálogo da loja */}
      {tenant.niche && (
        <StoreChatbot
          tenantName={tenant.name}
          niche={tenant.niche}
          tenantId={tenant.id}
        />
      )}
    </div>
  );
};

export default TenantStore;
