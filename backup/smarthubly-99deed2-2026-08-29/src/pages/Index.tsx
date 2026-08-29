import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Shield, Store, Rocket, Check, X, Zap, CreditCard,
  Bike, Calendar, Bot, BarChart3, MessageCircle, Printer,
  ChevronRight, Star, ArrowRight, Sparkles, Mail
} from 'lucide-react';
import adminLogo from '@/assets/logo-smarthubly.png';
import SofiaChat from '@/components/SofiaChat';
import SofiaFAQ from '@/components/SofiaFAQ';

const OWNER_WA = 'https://wa.me/5511912870761?text=Quero%20criar%20minha%20loja%20delivery';

const Index = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [storeCount, setStoreCount] = useState<number>(0);

  useEffect(() => {
    document.title = 'SmartHubly — Seu marketplace, suas regras';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', 'SmartHubly: crie seu marketplace em minutos. % justa por venda (a partir de 5%) ou R$60/mês. IA, agendamento, cliente é seu. Sem comissão abusiva.');

    (supabase as any).from('tenants_public').select('id', { count: 'exact', head: true }).eq('active', true)
      .then(({ count }: { count: number | null }) => setStoreCount(count || 0));
  }, []);

  const niches = [
    { icon: '🍔', label: 'Lanchonetes' },
    { icon: '🍕', label: 'Pizzarias' },
    { icon: '🍣', label: 'Restaurantes' },
    { icon: '💅', label: 'Salões/Barbearias' },
    { icon: '🛒', label: 'Mercados' },
    { icon: '💊', label: 'Farmácias' },
    { icon: '🌸', label: 'Floriculturas' },
    { icon: '🍰', label: 'Confeitarias' },
    { icon: '🍻', label: 'Bebidas' },
    { icon: '👔', label: 'Lojas em geral' },
  ];

  const features = [
    { icon: Store, title: 'Loja própria personalizada', desc: 'Sua URL, suas cores, seu logo. Link direto pra divulgar no Instagram e WhatsApp.' },
    { icon: CreditCard, title: 'Pagamento Pix + Cartão', desc: 'Mercado Pago integrado. Receba na hora, sem repasse demorado.' },
    { icon: Bike, title: 'Entrega flexível', desc: 'Você entrega, motoboy próprio ou integração Lalamove (conta sua). Você decide.' },
    { icon: Calendar, title: 'Agendamento de serviços', desc: 'Para salões, barbearias e estética. Cliente escolhe horário e pronto.' },
    { icon: Bot, title: 'Atendente IA 24h', desc: 'Chatbot inteligente responde dúvidas e ajuda o cliente a comprar sozinho.' },
    { icon: Printer, title: 'Impressão automática', desc: 'Pedido cai direto na impressora térmica da cozinha. Sem digitar nada.' },
    { icon: MessageCircle, title: 'WhatsApp integrado', desc: 'Pedido vai automático pro WhatsApp formatado e bonito.' },
    { icon: BarChart3, title: 'Painel financeiro', desc: 'Veja faturamento, taxas, comissões e relatórios em tempo real.' },
  ];

  const comparison = [
    { feature: 'Mensalidade', us: 'R$ 60 ou 0', ifood: 'R$ 100+ + comissão', anota: 'R$ 89 a R$ 249' },
    { feature: 'Comissão por venda', us: 'A partir de 5% (acordada)', ifood: '12% a 27%', anota: '0% (mas tem mensalidade)' },
    { feature: 'Loja personalizada', us: true, ifood: false, anota: true },
    { feature: 'Cliente é seu', us: true, ifood: false, anota: true },
    { feature: 'Atende serviços (salão, etc)', us: true, ifood: false, anota: false },
    { feature: 'IA atendente', us: true, ifood: false, anota: false },
    { feature: 'Setup em minutos', us: true, ifood: false, anota: true },
  ];

  const faqs = [
    { q: 'Quanto custa pra começar?', a: 'Você escolhe entre dois modelos: (1) % sobre cada venda, a partir de 5% (negociável de acordo com seu volume e nicho), ou (2) R$60/mês fixos com vendas ilimitadas. Sem taxa de adesão, sem fidelidade.' },
    { q: 'Como funciona a comissão por venda?', a: 'Combinamos uma porcentagem fixa (ex: 5%) que incide sobre cada produto vendido na sua loja. Você só paga quando vende. Ideal pra quem tá começando ou tem ticket variado.' },
    { q: 'Quando vale a pena a mensalidade fixa?', a: 'Se você fatura mais de R$1.200/mês na loja (com 5% daria R$60), o plano fixo passa a valer mais a pena. Conforme cresce, fica ainda melhor.' },
    { q: 'Como recebo o dinheiro dos pedidos?', a: 'Você conecta sua conta Mercado Pago e recebe direto na hora (Pix) ou em até 14 dias (cartão). O cliente paga você, não a plataforma.' },
    { q: 'Preciso ter motoboy próprio?', a: 'Não. Você pode (1) entregar você mesmo, (2) cadastrar seus motoboys, ou (3) usar a integração Lalamove on-demand. Importante: a conta Lalamove é sua — você cria, recarrega e paga as corridas direto pra eles. A plataforma só conecta a API; nenhum valor de entrega passa pela gente.' },
    { q: 'Funciona pra salão de beleza?', a: 'Sim! Tem módulo de agendamento completo: cliente escolhe serviço, horário disponível, e cai na sua agenda. Igual restaurante mas com hora marcada.' },
    { q: 'A IA responde os clientes mesmo?', a: 'Sim. O chatbot conhece seus produtos, preços, horários e tira dúvidas. Quando precisar de humano, encaminha pro seu WhatsApp.' },
    { q: 'Posso cancelar quando quiser?', a: 'Pode. Não tem fidelidade. Sua loja fica online enquanto você quiser.' },
    { q: 'Vocês cobram mais alguma coisa?', a: 'Não. A % combinada (ou os R$60 do plano fixo) é tudo que você paga pra plataforma. A taxa de entrega vai integral pro motoboy/Lalamove. Sem taxa escondida.' },
  ];

  useEffect(() => {
    const id = 'faq-jsonld';
    if (document.getElementById(id)) return;
    const s = document.createElement('script');
    s.id = id;
    s.type = 'application/ld+json';
    s.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
    document.head.appendChild(s);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/30 blur-xl rounded-full" aria-hidden />
              <img src={adminLogo} alt="SmartHubly Logo" className="relative w-10 h-10 object-contain rounded-full" style={{ maskImage: 'radial-gradient(circle, black 60%, transparent 100%)', WebkitMaskImage: 'radial-gradient(circle, black 60%, transparent 100%)' }} />
            </div>
            <span className="font-heading text-lg tracking-tight">SmartHubly</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#recursos" className="hover:text-foreground transition-colors">Recursos</a>
            <a href="#precos" className="hover:text-foreground transition-colors">Preços</a>
            <a href="#comparativo" className="hover:text-foreground transition-colors">Comparativo</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          </nav>
          <Link to="/super-admin" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Shield className="h-3.5 w-3.5" /> Admin
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative px-4 py-16 md:py-24 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(217_91%_60%/0.15),_transparent_50%)] pointer-events-none" />
        <div className="container mx-auto max-w-4xl text-center relative">
          <h1 className="font-heading text-4xl md:text-6xl leading-tight mb-6">
            Seu <span className="text-gradient">marketplace</span>, suas regras. Sem comissão abusiva.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Crie sua loja em minutos. Escolha entre <strong className="text-foreground">% acordada por venda</strong> (a partir de 5%) ou <strong className="text-foreground">R$60/mês fixos</strong>. Cliente é seu, dinheiro vai direto pra sua conta.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#contato" className="gradient-primary inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-medium text-primary-foreground hover:opacity-90 transition-opacity">
              <Rocket className="h-5 w-5" /> Quero criar minha loja
            </a>
            <a href="#recursos" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-colors">
              Ver como funciona <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
            <Check className="h-3 w-3 text-success" /> Sem cartão de crédito
            <span className="text-border">·</span>
            <Check className="h-3 w-3 text-success" /> Cancele quando quiser
            <span className="text-border">·</span>
            <Check className="h-3 w-3 text-success" /> Setup em minutos
          </p>
        </div>
      </section>

      {/* Niches */}
      <section className="px-4 py-12 border-y border-border bg-card/30">
        <div className="container mx-auto max-w-5xl">
          <p className="text-center text-sm text-muted-foreground mb-6">Atende todo tipo de comércio:</p>
          <div className="flex flex-wrap justify-center gap-3">
            {niches.map(n => (
              <div key={n.label} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border text-sm">
                <span className="text-lg">{n.icon}</span> {n.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="recursos" className="px-4 py-16 md:py-24">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl mb-3">Tudo que você precisa pra vender online</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Sem precisar de site, app ou agência. Pronto pra usar hoje.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map(f => (
              <div key={f.title} className="p-5 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
                <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="font-heading text-base mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="precos" className="px-4 py-16 md:py-24 bg-card/30 border-y border-border">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl mb-3">Preço simples e justo</h2>
            <p className="text-muted-foreground">Escolha o modelo que faz sentido pra você. Sem pegadinha.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
            <div className="p-6 rounded-2xl bg-card border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-5 w-5 text-primary" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Comissão por venda</span>
              </div>
              <h3 className="font-heading text-2xl mb-1">% acordada</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold">5%</span>
                <span className="text-muted-foreground text-sm">/ venda (a partir de)</span>
              </div>
              <p className="text-sm text-muted-foreground mb-5">A porcentagem é negociada com você de acordo com seu nicho e volume. Só paga quando vende.</p>
              <ul className="space-y-2 text-sm mb-6">
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> Sem mensalidade fixa</li>
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> % fixa combinada (ex: 5%, 7%, 10%)</li>
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> Todos os recursos inclusos</li>
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> Cobrança mensal acumulada</li>
              </ul>
              <a href="#contato" className="block text-center w-full py-3 rounded-lg bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors">Negociar minha %</a>
            </div>

            <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/10 to-card border border-primary/40 relative">
              <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">Recomendado</span>
              <div className="flex items-center gap-2 mb-3">
                <Star className="h-5 w-5 text-primary" />
                <span className="text-xs uppercase tracking-wide text-primary">Volume alto</span>
              </div>
              <h3 className="font-heading text-2xl mb-1">Mensalidade fixa</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-bold">R$ 60</span>
                <span className="text-muted-foreground text-sm">/ mês</span>
              </div>
              <p className="text-sm text-muted-foreground mb-5">Custo previsível. Vale a pena se você fatura mais de R$1.200/mês na loja.</p>
              <ul className="space-y-2 text-sm mb-6">
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> Vendas ilimitadas sem comissão</li>
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> Todos os recursos premium</li>
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> Sem fidelidade</li>
                <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /> Suporte prioritário</li>
              </ul>
              <a href="#contato" className="block text-center w-full py-3 rounded-lg gradient-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity">Quero esse plano</a>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section id="comparativo" className="px-4 py-16 md:py-24">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl mb-3">Por que não usar iFood ou Anota AI?</h2>
            <p className="text-muted-foreground">Compara você mesmo:</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left p-4 font-medium text-muted-foreground">Recurso</th>
                  <th className="p-4 font-heading text-primary">Nossa Plataforma</th>
                  <th className="p-4 text-muted-foreground">iFood</th>
                  <th className="p-4 text-muted-foreground">Anota AI</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="p-4 font-medium">{row.feature}</td>
                    <td className="p-4 text-center">
                      {typeof row.us === 'boolean' ? (
                        row.us ? <Check className="h-5 w-5 text-success mx-auto" /> : <X className="h-5 w-5 text-destructive mx-auto" />
                      ) : <span className="text-success font-medium">{row.us}</span>}
                    </td>
                    <td className="p-4 text-center text-muted-foreground">
                      {typeof row.ifood === 'boolean' ? (
                        row.ifood ? <Check className="h-5 w-5 text-success mx-auto" /> : <X className="h-5 w-5 text-destructive/60 mx-auto" />
                      ) : <span>{row.ifood}</span>}
                    </td>
                    <td className="p-4 text-center text-muted-foreground">
                      {typeof row.anota === 'boolean' ? (
                        row.anota ? <Check className="h-5 w-5 text-success mx-auto" /> : <X className="h-5 w-5 text-destructive/60 mx-auto" />
                      ) : <span>{row.anota}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 py-16 md:py-24 bg-card/30 border-y border-border">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl mb-3">Como começar</h2>
            <p className="text-muted-foreground">Três passos. Sem complicação.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { n: '1', t: 'Solicite sua loja', d: 'Fala com a gente. Em minutos sua loja está no ar com URL própria.' },
              { n: '2', t: 'Cadastre produtos', d: 'Use a IA pra gerar fotos, importar lista de produtos ou cadastra manualmente.' },
              { n: '3', t: 'Divulgue e venda', d: 'Compartilha o link no WhatsApp e Instagram. Pedidos chegam direto pra você.' },
            ].map(s => (
              <div key={s.n} className="p-6 rounded-xl bg-card border border-border text-center">
                <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center mx-auto mb-4 font-heading text-xl text-primary-foreground">{s.n}</div>
                <h3 className="font-heading text-lg mb-2">{s.t}</h3>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-4 py-16 md:py-24">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl mb-3">Perguntas frequentes</h2>
          </div>
          <div className="space-y-2">
            {faqs.map((f, i) => (
              <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/30 transition-colors">
                  <span className="font-medium pr-4">{f.q}</span>
                  <ChevronRight className={`h-5 w-5 text-muted-foreground shrink-0 transition-transform ${openFaq === i ? 'rotate-90' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">{f.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="contato" className="px-4 py-16 md:py-24 bg-gradient-to-b from-card/30 to-primary/5 border-t border-border">
        <div className="container mx-auto max-w-3xl text-center">
          <h2 className="font-heading text-3xl md:text-5xl mb-4">Pronto pra começar a vender?</h2>
          <p className="text-lg text-muted-foreground mb-8">Fala com a gente no WhatsApp. Sua loja fica pronta hoje.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href={OWNER_WA} target="_blank" rel="noopener noreferrer"
              className="gradient-primary inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-medium text-primary-foreground hover:opacity-90 transition-opacity">
              <MessageCircle className="h-5 w-5" /> WhatsApp +55 11 91287-0761
            </a>
            <button
              onClick={() => {
                const btn = document.querySelector<HTMLButtonElement>('[aria-label="Abrir chat com Sofia"]');
                btn?.click();
              }}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-colors">
              <Sparkles className="h-5 w-5" /> Conversar com a IA
            </button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Atendimento humano no WhatsApp · Sofia (IA) responde 24h aqui no site</p>
        </div>
      </section>

      {/* FAQ Sofia (IA) */}
      <section className="px-4 py-12 bg-muted/30">
        <div className="container mx-auto max-w-4xl">
          <SofiaFAQ />
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-8 border-t border-border bg-background">
        <div className="container mx-auto max-w-5xl flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src={adminLogo} alt="SmartHubly Logo" className="w-7 h-7 object-contain rounded-full" style={{ maskImage: 'radial-gradient(circle, black 60%, transparent 100%)', WebkitMaskImage: 'radial-gradient(circle, black 60%, transparent 100%)' }} />
            <span>SmartHubly © {new Date().getFullYear()} · Seu marketplace, suas regras.</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/super-admin" className="hover:text-foreground transition-colors flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" /> Admin
            </Link>
          </div>
        </div>
      </footer>

      {/* Sofia — IA atendente 24h (papel: visitante) */}
      <SofiaChat
        role="visitor"
        greeting="Oi! Sou a **Sofia** 👋 Posso tirar suas dúvidas sobre a plataforma, preços, recursos ou te ajudar a começar agora. O que você quer saber?"
      />
    </div>
  );
};

export default Index;
