import {
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
  Target,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import logo from '@/assets/smarthubly-vendedores-logo.png';

const principles = [
  ['Respeito', 'Entre vendedores, clientes, empresas parceiras e equipe SmartHubly.'],
  ['Transparência', 'Produtos, preços, comissões e condições devem ser apresentados corretamente.'],
  ['Ética nas vendas', 'Não são permitidas informações falsas ou promessas enganosas.'],
  ['Autonomia', 'Cada vendedor organiza sua rotina e escolhe seus canais de divulgação.'],
  ['Responsabilidade', 'Cada divulgação deve respeitar as regras da plataforma e do canal utilizado.'],
  ['Colaboração', 'Estratégias e aprendizados podem ser compartilhados para fortalecer a rede.'],
];

const channels = ['Instagram', 'WhatsApp', 'Facebook', 'TikTok', 'Indicações', 'Networking'];

const SellerNetwork = () => (
  <div className="min-h-screen overflow-hidden bg-slate-950 text-slate-100">
    <header className="border-b border-white/10 bg-slate-950/90">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <img src={logo} alt="SmartHubly" className="h-14 w-14 rounded-full object-cover ring-1 ring-amber-300/40" />
        <div><p className="text-lg font-bold text-white">SmartHubly</p><p className="text-xs uppercase tracking-[.18em] text-amber-200">Guia de vendedores</p></div>
      </div>
    </header>

    <main>
      <section className="relative isolate">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_20%,rgba(245,158,11,.18),transparent_32%),radial-gradient(circle_at_85%_5%,rgba(59,130,246,.18),transparent_35%)]" />
        <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-16 sm:px-6 md:pt-24 lg:grid-cols-[1.12fr_.88fr] lg:px-8 lg:pb-28">
          <div className="max-w-3xl self-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.18em] text-amber-200"><Sparkles className="h-3.5 w-3.5" /> SmartHubly Vendedores</div>
            <h1 className="text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-6xl">Venda com liberdade.<br /><span className="bg-gradient-to-r from-amber-200 via-yellow-400 to-orange-400 bg-clip-text text-transparent">Cresça com estrutura.</span></h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">Um guia completo para entender a rede de vendedores independentes da SmartHubly, sua dinâmica, responsabilidades e oportunidades.</p>
            <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-white/10 pt-6">{[['100%', 'autonomia'], ['1', 'identificação própria'], ['24/7', 'flexibilidade']].map(([value, label]) => <div key={label}><p className="text-2xl font-black text-white">{value}</p><p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</p></div>)}</div>
          </div>
          <div className="relative flex items-center justify-center lg:justify-end"><div className="absolute h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" /><div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-white/[.07] p-5 shadow-2xl shadow-amber-950/40 backdrop-blur-xl"><div className="flex items-center justify-between border-b border-white/10 pb-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-amber-300">Visão geral</p><p className="mt-1 text-lg font-bold text-white">Rede SmartHubly</p></div><div className="rounded-2xl bg-amber-400/15 p-3 text-amber-300"><BarChart3 className="h-6 w-6" /></div></div><div className="mt-5 grid grid-cols-2 gap-3">{[['Vendas', 'Acompanhe resultados', Wallet], ['Catálogo', 'Produtos atualizados', Package], ['Comissões', 'Registros claros', Award], ['Metas', 'Foco no resultado', Target]].map(([title, subtitle, Icon]) => { const I = Icon as typeof Wallet; return <div key={title as string} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"><I className="h-5 w-5 text-amber-300" /><p className="mt-5 text-sm font-bold text-white">{title as string}</p><p className="mt-1 text-xs text-slate-400">{subtitle as string}</p></div>; })}</div><div className="mt-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-400/10 p-4"><div className="rounded-full bg-emerald-400/15 p-2 text-emerald-300"><Check className="h-4 w-4" /></div><p className="text-sm text-slate-200">Cada venda com sua identificação fica registrada no sistema.</p></div></div></div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[.03]"><div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-amber-300">Objetivo</p><h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Conectar pessoas e empresas para vender mais.</h2><p className="mt-4 leading-7 text-slate-400">A SmartHubly Vendedores conecta pessoas com habilidade ou interesse em vendas a empresas que precisam ampliar seus canais comerciais. O vendedor atua de forma independente e comissionada, podendo escolher os produtos que conhece melhor.</p></div><div className="mt-12 grid gap-4 md:grid-cols-4">{[['01', 'Empresa parceira', 'Disponibiliza produtos e condições.'], ['02', 'Vendedor', 'Escolhe o que conhece e sabe divulgar.'], ['03', 'Cliente', 'Recebe atendimento e realiza a compra.'], ['04', 'Sistema', 'Identifica a venda e registra a comissão.']].map(([number, title, text]) => <div key={number} className="rounded-2xl border border-white/10 bg-slate-900/60 p-6"><span className="text-sm font-black text-amber-300">{number}</span><h3 className="mt-10 text-lg font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></div>)}</div></div></section>

      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-amber-300">Como funciona</p><h2 className="mt-3 text-3xl font-black text-white">Você não precisa vender tudo.</h2><p className="mt-4 leading-7 text-slate-400">Cada vendedor pode priorizar os produtos que conhece, entende, consegue apresentar melhor ou acredita que venderá com mais eficiência. Conforme novas empresas entrarem na rede, o catálogo poderá aumentar.</p><div className="mt-8 space-y-4">{[['Flexibilidade real', 'Escolha quando trabalhar e concilie as vendas com outras atividades.', Clock3], ['Ferramentas prontas', 'Catálogo, preços, informações e orientações para sua rotina.', Zap], ['Foco no resultado', 'Metas realistas por produto, sem obrigação de permanecer online.', Target]].map(([title, text, Icon]) => { const I = Icon as typeof Clock3; return <div key={title as string} className="flex gap-4"><div className="rounded-xl bg-amber-400/10 p-3 text-amber-300"><I className="h-5 w-5" /></div><div><h3 className="font-bold text-white">{title as string}</h3><p className="mt-1 text-sm leading-6 text-slate-400">{text as string}</p></div></div>; })}</div></div><div className="rounded-3xl border border-white/10 bg-gradient-to-br from-amber-500/15 to-orange-500/10 p-8"><div className="flex items-center gap-3"><div className="rounded-xl bg-amber-400/15 p-3 text-amber-300"><Network className="h-6 w-6" /></div><div><p className="text-xs font-bold uppercase tracking-widest text-amber-300">Dia a dia</p><h3 className="text-xl font-bold text-white">Informação para vender com confiança</h3></div></div><p className="mt-6 text-sm leading-7 text-slate-300">Podem ser disponibilizados catálogo atualizado, produtos em destaque, preços, comissões, condições comerciais, informações do produto, estratégias de abordagem e orientações de foco.</p><div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-5"><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Exemplo de foco do dia</p><p className="mt-3 font-bold text-white">Produto em destaque</p><div className="mt-3 grid gap-2 text-sm"><span className="text-slate-400">Preço atualizado</span><span className="text-slate-400">Comissão correspondente</span><span className="text-slate-400">Estratégia de abordagem</span></div></div></div></section>

      <section className="border-y border-white/10 bg-white/[.03]"><div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-amber-300">Divulgação</p><h2 className="mt-3 text-3xl font-black text-white">Use os canais que você domina.</h2><p className="mt-4 leading-7 text-slate-400">Instagram, WhatsApp, Facebook, TikTok, indicações, grupos, contatos pessoais e networking podem ser usados com responsabilidade.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{channels.map(channel => <div key={channel} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm font-semibold text-slate-200"><div className="rounded-lg bg-amber-400/10 p-2 text-amber-300">{channel === 'WhatsApp' ? <MessageCircle className="h-4 w-4" /> : <Users className="h-4 w-4" />}</div>{channel}</div>)}</div></div></div></section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr]"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-amber-300">Regras da rede</p><h2 className="mt-3 text-3xl font-black text-white">Crescer com confiança.</h2><p className="mt-4 leading-7 text-slate-400">A SmartHubly busca construir uma rede onde vendedores possam vender, aprender, compartilhar conhecimento e aumentar seus resultados de forma responsável.</p><div className="mt-7 flex items-center gap-3 text-sm font-semibold text-emerald-300"><ShieldCheck className="h-5 w-5" /> Transparência em cada etapa</div></div><div className="grid gap-3 sm:grid-cols-2">{principles.map(([title, text]) => <div key={title} className="rounded-2xl border border-white/10 bg-slate-900/50 p-5"><h3 className="font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></div>)}</div></div></section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl rounded-3xl border border-amber-300/20 bg-gradient-to-r from-amber-400/15 via-orange-500/15 to-yellow-400/10 p-8 text-center sm:p-12"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-300/15 text-amber-200"><BookOpen className="h-7 w-7" /></div><h2 className="mt-5 text-3xl font-black text-white">Aprender também faz parte da jornada.</h2><p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-300">A SmartHubly poderá disponibilizar capacitações sobre vendas, atendimento, negociação, marketing digital, redes sociais e prospecção.</p></div></section>
    </main>

    <footer className="border-t border-white/10 px-4 py-8 text-center text-sm text-slate-500"><p>SmartHubly Vendedores</p><p className="mt-2">Você escolhe o que vender, quando vender e como vender.</p></footer>
  </div>
);

export default SellerNetwork;
