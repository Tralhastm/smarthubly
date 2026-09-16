import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { BadgeDollarSign, CalendarDays, CheckCircle2, Copy, Package, RefreshCw, ShoppingBag, TrendingUp, XCircle } from 'lucide-react';

type Item = { product_name: string; quantity: number; unit_price: number; line_total: number };
type Order = { order_id: string; created_at: string; status: string; customer_name: string; customer_phone: string; customer_email: string | null; payment_method: string; total: number; discount_amount: number; items: Item[]; item_quantity: number; seller_sales: number; seller_amount: number };
type Dashboard = { seller: { name: string; phone: string | null; commission_percent: number; tenant_id: string }; codes: any[]; catalog: any[]; orders: Order[] };

const money = (n: unknown) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
const dateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const statusLabel: Record<string, string> = { received: 'Recebido', preparing: 'Em preparo', 'ready-for-pickup': 'Pronto', 'out-for-delivery': 'Em entrega', delivered: 'Entregue', cancelled: 'Cancelado', pending_payment: 'Aguardando pagamento', pending_review: 'Em análise' };

export default function SellerPanel() {
  const { token } = useParams<{ slug: string; token: string }>();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true); setError('');
    const { data: result, error: rpcError } = await (supabase as any).rpc('get_seller_dashboard', { _token: token });
    if (rpcError || result?.error) setError(rpcError?.message || result?.error || 'Painel indisponível');
    else setData(result as Dashboard);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [token]);

  const metrics = useMemo(() => {
    const orders = data?.orders || [];
    const valid = orders.filter(o => o.status !== 'cancelled');
    return {
      orders: valid.length,
      phones: valid.reduce((sum, o) => sum + Number(o.item_quantity || 0), 0),
      sales: valid.reduce((sum, o) => sum + Number(o.seller_sales || 0), 0),
      due: valid.reduce((sum, o) => sum + Number(o.seller_amount || 0), 0),
    };
  }, [data]);

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  if (loading) return <main className="min-h-screen bg-background p-6 text-muted-foreground"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> Carregando painel…</main>;
  if (error || !data) return <main className="min-h-screen bg-background p-6"><div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center"><XCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="text-xl font-bold">Painel não encontrado</h1><p className="mt-2 text-sm text-muted-foreground">{error || 'Confira o link recebido da loja.'}</p></div></main>;

  return <main className="min-h-screen bg-muted/30 pb-12">
    <header className="border-b bg-card"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Painel do vendedor</p><h1 className="text-2xl font-bold">Olá, {data.seller.name}</h1><p className="text-sm text-muted-foreground">Atualizado em {new Date().toLocaleString('pt-BR')}</p></div><div className="flex gap-2"><button onClick={copyLink} className="rounded-lg border bg-background px-3 py-2 text-sm">{copied ? <CheckCircle2 className="mr-1 inline h-4 w-4 text-green-600" /> : <Copy className="mr-1 inline h-4 w-4" />}{copied ? 'Copiado' : 'Copiar link'}</button><button onClick={() => void load()} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"><RefreshCw className="mr-1 inline h-4 w-4" /> Atualizar</button></div></div></header>
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[['Pedidos', metrics.orders, ShoppingBag], ['Celulares vendidos', metrics.phones, Package], ['Vendas', money(metrics.sales), TrendingUp], ['Você recebe', money(metrics.due), BadgeDollarSign]].map(([label, value, Icon]: any) => <div key={label} className="rounded-2xl border bg-card p-4 shadow-sm"><Icon className="mb-3 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">{label === 'Você recebe' ? 'Repasse' : label}</p><p className="mt-1 text-xl font-bold">{value}</p>{label === 'Você recebe' && <p className="mt-1 text-xs text-green-600">Repasse calculado pela loja</p>}</div>)}
      </section>
      <section className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-2xl border bg-card p-5"><h2 className="mb-3 flex items-center gap-2 font-semibold"><BadgeDollarSign className="h-5 w-5 text-primary" /> Código do vendedor</h2>{data.codes.map(code => <div key={code.id} className="mb-3 rounded-xl border p-3"><div className="flex items-center justify-between"><strong className="font-mono text-lg">{code.code}</strong><span className={`rounded-full px-2 py-1 text-xs ${code.active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>{code.active ? 'Ativo' : 'Inativo'}</span></div><p className="mt-1 text-sm text-muted-foreground">Desconto: {code.discount_type === 'percent' ? `${code.discount_value}%` : money(code.discount_value)} · {code.uses_count} uso(s)</p></div>)}{data.codes.length === 0 && <p className="text-sm text-muted-foreground">Nenhum código ativo.</p>}<p className="mt-4 text-xs text-muted-foreground">Cada compra feita com esse código fica vinculada automaticamente ao seu painel.</p></div>
        <div className="rounded-2xl border bg-card p-5"><h2 className="mb-3 flex items-center gap-2 font-semibold"><CalendarDays className="h-5 w-5 text-primary" /> Regras do repasse</h2><p className="text-sm text-muted-foreground">A loja calcula internamente custos, taxas e margem. O painel exibe somente o valor de repasse definido para o vendedor. Pedidos cancelados não entram no total.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Produtos no catálogo</p><strong>{data.catalog.length}</strong></div><div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Disponíveis agora</p><strong>{data.catalog.filter(p => p.in_stock !== false && (p.stock_quantity == null || Number(p.stock_quantity) > 0)).length}</strong></div><div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Data atual</p><strong>{new Date().toLocaleDateString('pt-BR')}</strong></div></div></div>
      </section>
      <section className="rounded-2xl border bg-card p-5"><h2 className="mb-4 flex items-center gap-2 font-semibold"><Package className="h-5 w-5 text-primary" /> Lista de produtos e preço de revenda</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.catalog.map(product => { const available = product.in_stock !== false && (product.stock_quantity == null || Number(product.stock_quantity) > 0); return <div key={product.id} className={`rounded-xl border p-3 ${!available ? 'opacity-60' : ''}`}><div className="flex gap-3">{product.image && <img src={product.image} alt="" className="h-16 w-16 rounded-lg object-cover" />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{product.name}</p><p className="text-lg font-bold text-primary">{money(product.price)}</p><p className="text-xs text-muted-foreground">{available ? 'Disponível' : 'Indisponível'}{product.updated_at ? ` · atualizado ${new Date(product.updated_at).toLocaleDateString('pt-BR')}` : ''}</p></div></div></div> })}</div></section>
      <section className="rounded-2xl border bg-card p-5"><h2 className="mb-4 flex items-center gap-2 font-semibold"><ShoppingBag className="h-5 w-5 text-primary" /> Vendas vinculadas</h2>{data.orders.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma venda vinculada ainda.</p> : <div className="space-y-3">{data.orders.map(order => <article key={order.order_id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">Pedido #{order.order_id.slice(0, 8)}</p><p className="text-xs text-muted-foreground">{dateTime(order.created_at)} · {order.customer_name} · {order.customer_phone}{order.customer_email ? ` · ${order.customer_email}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-xs ${order.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-primary/10 text-primary'}`}>{statusLabel[order.status] || order.status}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Itens</p><strong>{order.item_quantity}</strong></div><div><p className="text-xs text-muted-foreground">Valor dos seus itens</p><strong>{money(order.seller_sales)}</strong></div><div><p className="text-xs text-muted-foreground">Seu repasse</p><strong className="text-green-600">{money(order.seller_amount)}</strong></div></div><div className="mt-3 flex flex-wrap gap-2">{(order.items || []).map((item, index) => <span key={`${item.product_name}-${index}`} className="rounded-lg bg-muted px-2 py-1 text-xs">{item.quantity}× {item.product_name} · {money(item.line_total)}</span>)}</div></article>)}</div>}</section>
      <p className="text-center text-xs text-muted-foreground">Endereço de entrega não é exibido neste painel. Para dúvidas sobre pagamento ou repasse, fale com a loja.</p>
    </div>
  </main>;
}
