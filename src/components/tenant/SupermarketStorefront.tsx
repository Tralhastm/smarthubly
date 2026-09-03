import { useMemo, useRef, useState } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { useCart } from '@/contexts/CartContext';
import {
  Package, MessageCircle, Phone, MapPin, Clock, Mail, Search,
  ChevronLeft, ChevronRight, ShieldCheck, Truck, Factory, Leaf, Award, Camera, Handshake, ShoppingCart,
} from 'lucide-react';
import MediaCarousel from '@/components/shared/MediaCarousel';

// ============================================================
// MODO SUPERMERCADO / DISTRIBUIDORA — layout institucional premium
// Fiel ao layout aprovado (topbar + nav com logo central, hero,
// faixa de selos, catálogo em carrossel, rodapé em 3 colunas).
// 100% editável via tenants.storefront_config (JSON).
// ============================================================

export type StorefrontConfig = {
  hero_image?: string;
  hero_kicker?: string;
  hero_title?: string;
  hero_highlight?: string;
  hero_subtitle?: string;
  cta_primary?: string;
  cta_secondary?: string;
  badges?: { icon?: string; title: string; desc?: string }[];
  products_title?: string;
  products_subtitle?: string;
  products_cta?: string;
  about_title?: string;
  about_text?: string;
  about_image?: string;
  partner_title?: string;
  partner_text?: string;
  partner_cta?: string;
  partner_enabled?: boolean;
  partner_whatsapp?: string;
  partner_message?: string;
  contact_whatsapp?: string;
  contact_title?: string;
  contact_hours?: string;
  contact_email?: string;
  contact_address?: string;
  contact_city?: string;
  instagram_url?: string;
  order_title?: string;
  order_text?: string;
  nav_links?: { label: string; href: string }[];
  topbar_cta?: string;
  footer_note?: string;
  show_prices?: boolean;
  // Paleta do modo (padrão: marrom escuro + dourado + creme)
  color_dark?: string;
  color_gold?: string;
  color_cream?: string;
};

export const STOREFRONT_DEFAULTS = {
  hero_kicker: '',
  hero_title: 'Qualidade que você confia,',
  hero_highlight: 'sabor que sua família merece!',
  hero_subtitle:
    'Trabalhamos com os melhores produtos lácteos\npara levar mais sabor, saúde e confiança até você.',
  cta_primary: 'Conheça nossos produtos',
  cta_secondary: 'Seja nosso parceiro',
  products_title: 'Catálogo de Produtos',
  products_subtitle: 'Confira nossa linha completa selecionada para você.',
  products_cta: 'Ver todos os produtos',
  about_title: 'Sobre a Empresa',
  about_text:
    'Distribuímos produtos selecionados com rigor, mantendo a cadeia de qualidade do fornecedor até a sua mesa. Atendimento próximo, entrega ágil e preço justo.',
  partner_title: 'Atendimento Comercial',
  partner_text:
    'Mercados, padarias, restaurantes e revendedores: fale com nosso comercial e receba a tabela de preços no atacado.',
  partner_cta: 'Falar com o comercial',
  contact_title: 'Faça seu Pedido',
  order_title: 'Faça seu Pedido',
  order_text: 'Monte seu carrinho e finalize direto no WhatsApp com nosso time.',
  topbar_cta: 'Peça pelo WhatsApp',
  footer_note: 'Todos os direitos reservados.',
};

const ICONS: Record<string, any> = {
  shield: ShieldCheck,
  truck: Truck,
  factory: Factory,
  leaf: Leaf,
  award: Award,
};
const iconFor = (name?: string) => ICONS[name || ''] || ShieldCheck;

const DEFAULT_BADGES = [
  { icon: 'shield', title: 'Qualidade Garantida', desc: 'Produtos selecionados com rigor e segurança' },
  { icon: 'factory', title: 'Produção Controlada', desc: 'Processos padronizados e monitorados' },
  { icon: 'leaf', title: 'Sabor que Aproxima', desc: 'Produtos que unem tradição e qualidade' },
  { icon: 'truck', title: 'Entrega Rápida', desc: 'Atendimento ágil e entregas eficientes' },
];

const DEFAULT_NAV = [
  { label: 'Início', href: '#topo' },
  { label: 'Produtos', href: '#produtos' },
  { label: 'Empresa', href: '#sobre' },
  { label: 'Qualidade', href: '#selos' },
  { label: 'Onde comprar', href: '#contato' },
  { label: 'Área comercial', href: '#parceiro' },
  { label: 'Contato', href: '#contato' },
];

const SupermarketStorefront = ({ tenant }: { tenant: any }) => {
  const cfg: StorefrontConfig = (tenant?.storefront_config as StorefrontConfig) || {};
  const c = { ...STOREFRONT_DEFAULTS, ...cfg };
  const showPrices = cfg.show_prices !== false;
  const { data: products = [], isLoading } = useProducts(tenant?.id);
  const { addToCart } = useCart();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('todas');
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const dark = cfg.color_dark || '#1B1008';
  const gold = cfg.color_gold || '#C9A44C';
  const cream = cfg.color_cream || '#F7F2E9';

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean) as string[]);
    return ['todas', ...Array.from(set)];
  }, [products]);

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const okCat = category === 'todas' || p.category === category;
        const okQ = !query || p.name.toLowerCase().includes(query.toLowerCase());
        return okCat && okQ;
      }),
    [products, category, query],
  );

  // Número de contato do site (editável no admin). Vazio = usa o WhatsApp da loja.
  const contactNumber = String(cfg.contact_whatsapp || tenant?.whatsapp || '').replace(/\D/g, '');
  const wa = contactNumber ? `https://wa.me/${contactNumber}` : '';
  // Seção "Seja nosso parceiro" (pode ser desligada e ter número/mensagem próprios)
  const partnerEnabled = cfg.partner_enabled !== false;
  const partnerNumber = String(cfg.partner_whatsapp || contactNumber || '').replace(/\D/g, '');
  const partnerMessage = cfg.partner_message || 'Quero ser parceiro';
  const partnerWa = partnerNumber
    ? `https://wa.me/${partnerNumber}?text=${encodeURIComponent(partnerMessage)}`
    : '';
  const badges = cfg.badges?.length ? cfg.badges : DEFAULT_BADGES;
  const nav = (cfg.nav_links?.length ? cfg.nav_links : DEFAULT_NAV).filter(
    (l) => partnerEnabled || l.href !== '#parceiro',
  );
  const navLeft = nav.slice(0, Math.ceil(nav.length / 2));
  const navRight = nav.slice(Math.ceil(nav.length / 2));

  const scrollTrack = (dir: 1 | -1) => {
    trackRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  const NavLink = ({ l, active }: { l: { label: string; href: string }; active?: boolean }) => (
    <a
      href={l.href}
      className="relative py-4 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
      style={{ color: active ? gold : '#EFE7D8' }}
    >
      {l.label}
      {active && <span className="absolute inset-x-0 -bottom-px h-0.5" style={{ background: gold }} />}
    </a>
  );

  return (
    <div style={{ background: dark, color: '#EFE7D8' }}>
      {/* TOPBAR */}
      <div className="border-b" style={{ borderColor: `${gold}33` }}>
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs" style={{ color: '#EFE7D8' }}>
            <MapPin className="h-3.5 w-3.5" style={{ color: gold }} />
            {cfg.contact_city || tenant.address || ''}
          </span>
          <div className="flex flex-wrap items-center gap-4">
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium">
                <MessageCircle className="h-4 w-4" style={{ color: '#25D366' }} />
                {cfg.contact_whatsapp || tenant.phone || tenant.whatsapp}
              </a>
            )}
            {cfg.instagram_url && (
              <a href={cfg.instagram_url} target="_blank" rel="noreferrer" aria-label="Instagram">
                <Camera className="h-4 w-4" />
              </a>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border px-4 py-2 text-xs font-bold uppercase tracking-wide transition hover:opacity-90"
                style={{ borderColor: gold, color: gold }}
              >
                <MessageCircle className="h-4 w-4" /> {c.topbar_cta}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* NAV + LOGO CENTRAL */}
      <div className="relative z-30 border-b" style={{ borderColor: `${gold}33`, background: dark }}>
        <div className="container mx-auto flex items-center justify-center gap-6 px-4 lg:justify-between">
          <nav className="hidden flex-wrap items-center gap-7 lg:flex">
            {navLeft.map((l, i) => (
              <NavLink key={i} l={l} active={i === 0} />
            ))}
          </nav>
          <div className="lg:w-[220px]" />
          <nav className="hidden flex-wrap items-center gap-7 lg:flex">
            {navRight.map((l, i) => (
              <NavLink key={i} l={l} />
            ))}
          </nav>
          <nav className="flex flex-wrap items-center justify-center gap-4 py-3 lg:hidden">
            {nav.map((l, i) => (
              <NavLink key={i} l={l} active={i === 0} />
            ))}
          </nav>
        </div>
        {tenant.logo_url && (
          <img
            src={tenant.logo_url}
            alt={tenant.name}
            className="pointer-events-none absolute left-1/2 top-1/2 z-30 hidden h-[130px] -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-xl lg:block"
          />
        )}
      </div>

      {/* HERO */}
      <section id="topo" className="relative">
        {c.hero_image ? (
          <img src={c.hero_image} alt={`${tenant.name} — destaque`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: dark }} />
        )}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(90deg, ${dark} 0%, ${dark}E6 35%, ${dark}66 65%, transparent 100%)` }}
        />
        <div className="container relative z-10 mx-auto px-4 pb-36 pt-16 md:pb-44 md:pt-24">
          <div className="max-w-2xl">
            {c.hero_kicker && (
              <span
                className="inline-block rounded-full border px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em]"
                style={{ borderColor: `${gold}66`, color: gold }}
              >
                {c.hero_kicker}
              </span>
            )}
            <h1 className="mt-4 font-serif text-4xl leading-[1.15] md:text-6xl">
              <span className="block">{c.hero_title}</span>
              <span className="block italic" style={{ color: gold }}>{c.hero_highlight}</span>
            </h1>
            <p className="mt-6 whitespace-pre-line text-base leading-relaxed md:text-lg" style={{ color: '#E4DAC7' }}>
              {c.hero_subtitle}
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#produtos"
                className="flex items-center gap-2 rounded-md px-7 py-4 text-sm font-bold uppercase tracking-wide transition hover:opacity-90"
                style={{ background: gold, color: dark }}
              >
                <ShoppingCart className="h-4 w-4" /> {c.cta_primary}
              </a>
              {partnerEnabled && partnerWa && (
                <a
                  href={partnerWa}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md border px-7 py-4 text-sm font-bold uppercase tracking-wide transition hover:opacity-90"
                  style={{ borderColor: gold, color: '#EFE7D8' }}
                >
                  <Handshake className="h-4 w-4" style={{ color: gold }} /> {c.cta_secondary}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* FAIXA DE SELOS sobreposta */}
        <div id="selos" className="container relative z-10 mx-auto -mb-16 translate-y-4 px-4 md:-mb-20">
          <div
            className="grid grid-cols-1 gap-6 rounded-md px-6 py-6 shadow-2xl sm:grid-cols-2 lg:grid-cols-4 lg:gap-0"
            style={{ background: dark, border: `1px solid ${gold}40` }}
          >
            {badges.map((b, i) => {
              const Icon = iconFor(b.icon);
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 lg:px-6"
                  style={i > 0 ? { borderLeft: `1px solid ${gold}26` } : undefined}
                >
                  <Icon className="mt-0.5 h-9 w-9 shrink-0" strokeWidth={1.2} style={{ color: gold }} />
                  <div>
                    <p className="font-serif text-base font-semibold" style={{ color: gold }}>{b.title}</p>
                    {b.desc && <p className="mt-1 text-sm leading-snug" style={{ color: '#D9CFBB' }}>{b.desc}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PRODUTOS */}
      <section id="produtos" style={{ background: cream, color: dark }} className="pb-16 pt-28 md:pt-32">
        <div className="container mx-auto px-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl md:text-4xl">{c.products_title}</h2>
              <p className="mt-2 text-sm opacity-70">{c.products_subtitle}</p>
            </div>
            <button
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-2 rounded-md px-6 py-3 text-xs font-bold uppercase tracking-wide transition hover:opacity-90"
              style={{ background: gold, color: dark }}
            >
              {showAll ? 'Ver menos' : c.products_cta} <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {showAll && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar produto..."
                  className="w-full rounded-md border bg-white py-2.5 pl-10 pr-4 text-sm outline-none"
                  style={{ borderColor: `${dark}22`, color: dark }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className="rounded-full border px-4 py-1.5 text-xs font-medium capitalize transition"
                    style={
                      category === cat
                        ? { borderColor: gold, background: `${gold}22`, color: dark }
                        : { borderColor: `${dark}22`, color: `${dark}99` }
                    }
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 text-center text-sm opacity-60">Carregando produtos...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm opacity-60">Nenhum produto encontrado.</div>
          ) : showAll ? (
            <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-4 lg:grid-cols-6">
              {filtered.map((p, i) => (
                <ProductCard key={p.id} p={p} i={i} gold={gold} dark={dark} showPrices={showPrices} onDetails={setDetail} />
              ))}
            </div>
          ) : (
            <div className="relative mt-8">
              <button
                onClick={() => scrollTrack(-1)}
                aria-label="Anterior"
                className="absolute -left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md md:flex"
                style={{ color: dark }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div
                ref={trackRef}
                className="flex gap-5 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {filtered.map((p, i) => (
                  <div key={p.id} className="w-[46%] shrink-0 sm:w-[31%] md:w-[23%] lg:w-[15.5%]">
                    <ProductCard p={p} i={i} gold={gold} dark={dark} showPrices={showPrices} onDetails={setDetail} />
                  </div>
                ))}
              </div>
              <button
                onClick={() => scrollTrack(1)}
                aria-label="Próximo"
                className="absolute -right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md md:flex"
                style={{ color: dark }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* RODAPÉ INSTITUCIONAL — 3 COLUNAS */}
      <section id="sobre" style={{ background: dark }} className="py-14">
        <div className="container mx-auto grid grid-cols-1 gap-10 px-4 md:grid-cols-3">
          <div className="md:pr-8" style={{ borderRight: `1px solid ${gold}26` }}>
            <h3 className="font-serif text-2xl" style={{ color: '#EFE7D8' }}>{c.about_title}</h3>
            <div className="mt-3 h-0.5 w-16" style={{ background: gold }} />
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed" style={{ color: '#C9BFAB' }}>
              {c.about_text}
            </p>
            {cfg.about_image && (
              <img src={cfg.about_image} alt={`Sobre ${tenant.name}`} loading="lazy" className="mt-5 w-full rounded-md object-cover" />
            )}
          </div>

          {partnerEnabled && (
          <div id="parceiro" className="md:px-8" style={{ borderRight: `1px solid ${gold}26` }}>
            <h3 className="font-serif text-2xl" style={{ color: '#EFE7D8' }}>{c.partner_title}</h3>
            <div className="mt-3 h-0.5 w-16" style={{ background: gold }} />
            <p className="mt-4 text-sm leading-relaxed" style={{ color: '#C9BFAB' }}>{c.partner_text}</p>
            {partnerWa && (
              <a
                href={partnerWa}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-2 rounded-md px-5 py-3 text-xs font-bold uppercase tracking-wide"
                style={{ background: gold, color: dark }}
              >
                <Handshake className="h-4 w-4" /> {c.partner_cta}
              </a>
            )}
          </div>
          )}

          <div id="contato" className="md:pl-8">
            <h3 className="font-serif text-2xl" style={{ color: '#EFE7D8' }}>{c.order_title}</h3>
            <div className="mt-3 h-0.5 w-16" style={{ background: gold }} />
            <p className="mt-4 text-sm leading-relaxed" style={{ color: '#C9BFAB' }}>{c.order_text}</p>
            <ul className="mt-5 space-y-3 text-sm" style={{ color: '#C9BFAB' }}>
              {wa && (
                <li className="flex items-center gap-2">
                  <Phone className="h-4 w-4" style={{ color: gold }} />
                  <a href={wa} target="_blank" rel="noreferrer">{cfg.contact_whatsapp || tenant.phone || tenant.whatsapp}</a>
                </li>
              )}
              {(cfg.contact_address || tenant.address) && (
                <li className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" style={{ color: gold }} />
                  {cfg.contact_address || tenant.address}
                </li>
              )}
              {cfg.contact_hours && (
                <li className="flex items-center gap-2">
                  <Clock className="h-4 w-4" style={{ color: gold }} />
                  {cfg.contact_hours}
                </li>
              )}
              {cfg.contact_email && (
                <li className="flex items-center gap-2">
                  <Mail className="h-4 w-4" style={{ color: gold }} />
                  <a href={`mailto:${cfg.contact_email}`}>{cfg.contact_email}</a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <p className="container mx-auto mt-12 px-4 text-center text-xs" style={{ color: '#8B8070' }}>
          © {new Date().getFullYear()} {tenant.name}. {c.footer_note}
        </p>
      </section>

      {/* SPLASH / MODAL EXPANDIDO DO PRODUTO — carrossel + info + carrinho */}
      {detail && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          onClick={() => setDetail(null)}
        >
          {/* Fundo escurecido */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden />
          {/* Painel expandido */}
          <div
            className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-in slide-in-from-bottom duration-300 sm:rounded-2xl sm:my-6"
            style={{ color: dark }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Alça de arraste (mobile) */}
            <div className="relative flex items-center justify-center border-b px-4 py-2" style={{ borderColor: `${dark}14` }}>
              <div className="h-1.5 w-10 rounded-full bg-black/25 sm:hidden" />
              <span className="absolute left-4 text-[11px] uppercase tracking-widest opacity-50">
                {detail.category || 'Produto'}
              </span>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setDetail(null)}
                className="absolute right-4 flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-black/10"
                style={{ color: dark }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1L13 13M13 1L1 13" />
                </svg>
              </button>
            </div>
            {/* Galeria do carrossel */}
            <div className="flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden bg-[#F5F1E8] sm:aspect-[16/10]">
              {(detail.media && detail.media.length > 0) || detail.image ? (
                <MediaCarousel
                  items={
                    (detail.media && detail.media.length > 0
                      ? detail.media
                      : [{ type: 'image' as const, url: detail.image }]).map((m: any) => ({
                      type: m.type === 'video' ? 'video' : 'image',
                      url: m.url,
                    }))
                  }
                  imgClassName="h-full w-full object-contain"
                  videoClassName="h-full w-full object-cover"
                />
              ) : (
                <Package className="h-20 w-20" style={{ color: `${gold}60` }} />
              )}
            </div>
            {/* Conteúdo */}
            <div className="flex flex-col gap-3 overflow-y-auto px-6 py-5">
              {detail.category && (
                <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: gold }}>
                  {detail.category}
                </p>
              )}
              <h2 className="font-serif text-2xl leading-snug" style={{ color: dark }}>{detail.name}</h2>
              {detail.description && (
                <p className="text-sm leading-relaxed opacity-80">{detail.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {showPrices && detail.price > 0 && (
                  <p className="text-2xl font-bold" style={{ color: gold }}>
                    R$ {Number(detail.price).toFixed(2)}
                  </p>
                )}
                {detail.original_price > 0 && detail.original_price > detail.price && (
                  <p className="text-sm text-strikethrough line-through opacity-50">
                    R$ {Number(detail.original_price).toFixed(2)}
                  </p>
                )}
                {detail.in_stock === false ? (
                  <span className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide bg-red-50 text-red-600">Esgotado</span>
                ) : detail.stock_quantity != null ? (
                  <span className="text-[11px] opacity-60">{detail.stock_quantity} em estoque</span>
                ) : null}
              </div>
              <button
                onClick={() => { addToCart(detail); setDetail(null); }}
                disabled={detail.in_stock === false}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-xs font-bold uppercase tracking-wider transition hover:opacity-90 disabled:opacity-40"
                style={{ background: gold, color: dark }}
              >
                <ShoppingCart className="h-4 w-4" />
                {detail.in_stock === false ? 'Indisponível' : 'Adicionar ao carrinho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOTÃO FLUTUANTE WHATSAPP */}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full px-5 py-3 shadow-2xl transition hover:opacity-90"
          style={{ background: '#25D366', color: '#0B2E17' }}
        >
          <MessageCircle className="h-6 w-6" />
          <span className="hidden text-xs font-semibold leading-tight sm:block">
            Fale conosco
            <br />
            pelo WhatsApp
          </span>
        </a>
      )}
    </div>
  );
};

const ProductCard = ({
  p, i, gold, dark, showPrices, onDetails,
}: { p: any; i: number; gold: string; dark: string; showPrices: boolean; onDetails: (p: any) => void }) => (
  <article
    className="group flex h-full cursor-pointer flex-col rounded-md bg-white p-4 text-center shadow-sm transition hover:shadow-lg"
    style={{ border: `1px solid ${dark}14` }}
    onClick={() => onDetails(p)}
  >
    <div className="relative mb-3 flex aspect-square items-center justify-center overflow-hidden">
      <span
        className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: gold, color: dark }}
      >
        {String(i + 1).padStart(2, '0')}
      </span>
      {p.image ? (
        <img
          src={p.image}
          alt={p.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <Package className="h-12 w-12" style={{ color: `${gold}80` }} />
      )}
    </div>
    <h3 className="font-serif text-sm leading-snug" style={{ color: dark }}>{p.name}</h3>
    {p.description && (
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-65" style={{ color: dark }}>
        {p.description}
      </p>
    )}
    {showPrices && p.price > 0 && (
      <p className="mt-1 text-sm font-bold" style={{ color: gold }}>R$ {p.price.toFixed(2)}</p>
    )}
    <button
      onClick={() => onDetails(p)}
      className="mx-auto mt-3 rounded-sm border px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition hover:opacity-80 disabled:opacity-40"
      style={{ borderColor: `${dark}33`, color: dark }}
    >
      {p.description ? 'Ver mais' : 'Ver detalhes'}
    </button>
  </article>
);

export default SupermarketStorefront;
