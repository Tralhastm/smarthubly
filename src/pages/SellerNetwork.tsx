import { Link, useParams } from 'react-router-dom';
import { useTenantBySlug } from '@/hooks/useTenants';
import {
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Check,
  Clock3,
  MessageCircle,
  Network,
  Package,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';

const principles = [
  ['Respeito', 'Entre vendedores, clientes, empresas parceiras e equipe SmartHubly.'],
  ['Transparência', 'Produtos, preços, comissões e condições sempre apresentados corretamente.'],
  ['Ética nas vendas', 'Sem informações falsas, promessas enganosas ou práticas prejudiciais.'],
  ['Autonomia', 'Cada vendedor organiza sua rotina e escolhe seus canais de divulgação.'],
  ['Responsabilidade', 'Cada divulgação deve respeitar as regras da plataforma e do canal usado.'],
  ['Colaboração', 'Estratégias e aprendizados podem ser compartilhados para fortalecer a rede.'],
];

const channels = ['Instagram', 'WhatsApp', 'Facebook', 'TikTok', 'Indicações', 'Networking'];

const SellerNetwork = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: tenant } = useTenantBySlug(slug);
  const storeName = tenant?.name || 'SmartHubly';

  return (
    <div className="min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to={`/loja/${slug}`} className="flex items-center gap-3" aria-label={`Voltar para ${storeName}`}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20">
              {tenant?.logo_url ? <img src={tenant.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <Store className="h-5 w-5 text-white" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{storeName}</p>
              <p className="text-xs text-slate-400">SmartHubly Vendedores</p>
            </div>
          </Link>
          <Link to={`/loja/${slug}`} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-300/50 hover:bg-white/10">
            Ver produtos <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main>
        <section className="relative isolate">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_20%,rgba(34,211,238,.16),transparent_33%),radial-gradient(circle_at_85%_5%,rgba(59,130,246,.2),transparent_35%)]" />
          <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-16 sm:px-6 md:pt-24 lg:grid-cols-[1.12fr_.88fr] lg:px-8 lg:pb-28">
            <div className="max-w-3xl self-center">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.18em] text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" /> Rede SmartHubly
              </div>
              <h1 className="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-6xl">
                Venda com liberdade.<br /><span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 bg-clip-text text-transparent">Cresça com estrutura.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                Conectamos vendedores independentes a empresas que querem vender mais, com catálogo atualizado, links próprios e acompanhamento claro de cada oportunidade.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href="#como-funciona" className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3.5 font-bold text-slate-950 shadow-xl shadow-cyan-500/20 transition hover:bg-cyan-300">
                  Conhecer o programa <ArrowRight className="h-4 w-4" />
                </a>
                <Link to={`/loja/${slug}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3.5 font-semibold text-white transition hover:bg-white/10">
                  Explorar catálogo <Package className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-white/10 pt-6">
                {[['100%', 'autonomia'], ['1', 'código próprio'], ['24/7', 'flexibilidade']].map(([value, label]) => (
                  <div key={label}><p className="text-2xl font-black text-white">{value}</p><p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</p></div>
                ))}
              </div>
            </div>

            <div className="relative flex items-center justify-center lg:justify-end">
              <div className="absolute h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
              <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-white/[.07] p-5 shadow-2xl shadow-cyan-950/40 backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div><p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">Painel do vendedor</p><p className="mt-1 text-lg font-bold text-white">Seu próximo resultado</p></div>
                  <div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-300"><BarChart3 className="h-6 w-6" /></div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[['Vendas', 'Acompanhe tudo', Wallet], ['Catálogo', 'Sempre atualizado', Package], ['Comissões', 'Claras e registradas', Award], ['Metas', 'Foco no resultado', Target]].map(([title, subtitle, Icon]) => {
                    const IconComponent = Icon as typeof Wallet;
                    return <div key={title as string} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"><IconComponent className="h-5 w-5 text-cyan-300" /><p className="mt-5 text-sm font-bold text-white">{title as string}</p><p className="mt-1 text-xs text-slate-400">{subtitle as string}</p></div>;
                  })}
                </div>
                <div className="mt-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-blue-500/20 to-cyan-400/10 p-4"><div className="rounded-full bg-emerald-400/15 p-2 text-emerald-300"><Check className="h-4 w-4" /></div><p className="text-sm text-slate-200">Cada venda com seu código fica registrada automaticamente.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="border-y border-white/10 bg-white/[.03]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-cyan-300">Como funciona</p><h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Uma rede comercial feita para vender melhor.</h2><p className="mt-4 leading-7 text-slate-400">A empresa disponibiliza produtos e condições. O vendedor escolhe como divulgar, conversa com seus clientes e acompanha tudo pelo próprio painel.</p></div>
            <div className="mt-12 grid gap-4 md:grid-cols-4">
              {[['01', 'Empresa parceira', 'Produtos, preços e condições comerciais.'], ['02', 'Vendedor', 'Escolhe o que conhece e sabe divulgar.'], ['03', 'Cliente', 'Recebe atendimento e faz a compra.'], ['04', 'Sistema', 'Identifica o código e registra a comissão.']].map(([number, title, text], index) => <div key={number} className="relative rounded-2xl border border-white/10 bg-slate-900/60 p-6"><span className="text-sm font-black text-cyan-300">{number}</span><h3 className="mt-10 text-lg font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>{index < 3 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-6 w-6 text-cyan-300 md:block" />}</div>)}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div><p className="text-sm font-bold uppercase tracking-[.18em] text-cyan-300">Do seu jeito</p><h2 className="mt-3 text-3xl font-black text-white">Você não precisa vender tudo.</h2><p className="mt-4 leading-7 text-slate-400">Priorize os produtos que conhece, entende e consegue apresentar melhor. A rede cresce com diferentes empresas e novas oportunidades.</p><div className="mt-8 space-y-4">{[['Flexibilidade real', 'Escolha quando trabalhar e concilie com seus outros compromissos.', Clock3], ['Ferramentas prontas', 'Catálogo, preços, links de venda e orientações para sua rotina.', Zap], ['Foco no resultado', 'Metas realistas por produto, sem obrigação de ficar online.', Target]].map(([title, text, Icon]) => { const I = Icon as typeof Clock3; return <div key={title as string} className="flex gap-4"><div className="rounded-xl bg-cyan-400/10 p-3 text-cyan-300"><I className="h-5 w-5" /></div><div><h3 className="font-bold text-white">{title as string}</h3><p className="mt-1 text-sm leading-6 text-slate-400">{text as string}</p></div></div>; })}</div></div>
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-blue-500/15 to-violet-500/10 p-8"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-400/15 p-3 text-violet-300"><Network className="h-6 w-6" /></div><div><p className="text-xs font-bold uppercase tracking-widest text-violet-300">Dia a dia</p><h3 className="text-xl font-bold text-white">Conteúdo para vender com confiança</h3></div></div><p className="mt-6 text-sm leading-7 text-slate-300">Todos os dias podem ser disponibilizados produtos em destaque, preços, comissões, links, estratégias de abordagem e informações para ajudar você a começar.</p><div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-5"><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Foco do dia</p><p className="mt-3 font-bold text-white">Smartphone em destaque</p><div className="mt-3 flex items-center justify-between text-sm"><span className="text-slate-400">Preço atualizado</span><span className="font-bold text-cyan-300">Link próprio</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-3/4 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" /></div></div></div>
        </section>

        <section className="border-y border-white/10 bg-white/[.03]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-cyan-300">Canais de divulgação</p><h2 className="mt-3 text-3xl font-black text-white">Use onde você já tem presença.</h2><p className="mt-4 leading-7 text-slate-400">A divulgação nas redes e nos canais pessoais é organizada pelo próprio vendedor, sempre com responsabilidade e transparência.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{channels.map((channel, index) => <div key={channel} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm font-semibold text-slate-200"><div className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300">{index === 1 ? <MessageCircle className="h-4 w-4" /> : <Users className="h-4 w-4" />}</div>{channel}</div>)}</div></div></div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr]"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-cyan-300">Nossa base</p><h2 className="mt-3 text-3xl font-black text-white">Crescer sem pressão.</h2><p className="mt-4 leading-7 text-slate-400">Queremos construir uma rede onde as pessoas possam vender, aprender, compartilhar conhecimento e melhorar seus resultados.</p><div className="mt-7 flex items-center gap-3 text-sm font-semibold text-emerald-300"><ShieldCheck className="h-5 w-5" /> Transparência em cada etapa</div></div><div className="grid gap-3 sm:grid-cols-2">{principles.map(([title, text]) => <div key={title} className="rounded-2xl border border-white/10 bg-slate-900/50 p-5"><h3 className="font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></div>)}</div></div></section>

        <section className="px-4 pb-20 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-cyan-300/20 bg-gradient-to-r from-cyan-400/15 via-blue-500/15 to-violet-500/15 p-8 text-center sm:p-12"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-300/15 text-cyan-200"><BookOpen className="h-7 w-7" /></div><h2 className="mt-5 text-3xl font-black text-white">Aprender também faz parte da jornada.</h2><p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-300">Capacitações sobre vendas, atendimento, negociação, marketing digital, redes sociais e prospecção podem ajudar você a evoluir dentro da rede.</p><Link to={`/loja/${slug}`} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3.5 font-bold text-slate-950 transition hover:bg-cyan-100">Conhecer a loja <ArrowRight className="h-4 w-4" /></Link></div></section>
      </main>

      <footer className="border-t border-white/10 px-4 py-8 text-center text-sm text-slate-500"><p>SmartHubly Vendedores · {storeName}</p><p className="mt-2">Você escolhe o que vender, quando vender e como vender.</p></footer>
    </div>
  );
};

export default SellerNetwork;
