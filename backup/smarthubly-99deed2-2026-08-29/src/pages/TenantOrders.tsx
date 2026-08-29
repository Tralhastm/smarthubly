import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenantBySlug } from '@/hooks/useTenants';
import { Search, Package, Clock, ChefHat, Truck, CheckCircle, ArrowLeft, Store, CreditCard, XCircle, Hash, Phone, MapPin } from 'lucide-react';
import { CANCELLED_ORDER_STATUS } from '@/lib/order-status';
import CustomerOrderChat from '@/components/tenant/CustomerOrderChat';
import { deriveBrandTokens, applyBrandTokens, clearBrandTokens } from '@/lib/color-utils';

// Detecta se a busca é um código curto de pedido (#977532) ou telefone.
// Códigos: 6+ caracteres hex (0-9 a-f). Telefones: só dígitos, 10+.
const detectSearchKind = (raw: string): 'code' | 'phone' | 'invalid' => {
  const trimmed = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6,}$/.test(trimmed) && /[a-fA-F]/.test(trimmed)) return 'code';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10) return 'phone';
  // Sem letras + 6 dígitos exatos => trata como código (UUID curto pode ser só números)
  if (/^[0-9]{6,8}$/.test(trimmed) && digits.length < 10) return 'code';
  return 'invalid';
};

const statusConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending_payment: { label: 'Aguardando Pagamento', icon: <CreditCard className="h-4 w-4" />, color: 'bg-purple-500/20 text-purple-400' },
  received: { label: 'Recebido', icon: <Clock className="h-4 w-4" />, color: 'bg-blue-500/20 text-blue-400' },
  preparing: { label: 'Em Preparo', icon: <ChefHat className="h-4 w-4" />, color: 'bg-yellow-500/20 text-yellow-400' },
  'out-for-delivery': { label: 'Saiu para Entrega', icon: <Truck className="h-4 w-4" />, color: 'bg-orange-500/20 text-orange-400' },
  'ready-for-pickup': { label: 'Pronto p/ Retirada', icon: <Store className="h-4 w-4" />, color: 'bg-cyan-500/20 text-cyan-400' },
  delivered: { label: 'Entregue', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-green-500/20 text-green-400' },
  cancelled: { label: 'Cancelado', icon: <XCircle className="h-4 w-4" />, color: 'bg-red-500/20 text-red-400' },
};

type OrderWithItems = {
  id: string; status: string; total: number; delivery_type: string; payment_method: string; created_at: string; customer_name: string;
  customer_phone?: string | null;
  tenant_id?: string;
  delivery_status_note: string | null;
  lalamove_share_link?: string | null;
  lalamove_status?: string | null;
  external_tracking_url?: string | null;
  external_tracking_provider?: string | null;
  order_items: { id: string; product_name: string; product_price: number; quantity: number }[];
};

const TenantOrders = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: tenant, isLoading: loadingTenant } = useTenantBySlug(slug);
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Última busca pra auto-refresh: { kind, value }
  const [lastSearch, setLastSearch] = useState<{ kind: 'code' | 'phone'; value: string } | null>(null);

  // Aplica identidade visual da loja (mesmo padrão de TenantStore)
  useEffect(() => {
    if (!tenant) return;
    const primary = (tenant as any).brand_primary_color || '#3B82F6';
    const bg = (tenant as any).brand_bg_color || '#FFFFFF';
    const root = document.documentElement;
    const tokens = deriveBrandTokens(primary, bg);
    applyBrandTokens(root, tokens);
    root.classList.remove('dark');
    return () => clearBrandTokens(root, Object.keys(tokens));
  }, [tenant]);

  const fetchOrders = useCallback(async (kind: 'code' | 'phone', value: string) => {
    if (!tenant) return;
    if (kind === 'phone') {
      // Busca segura por telefone via RPC (não expõe a coluna customer_phone publicamente)
      const { data: ords } = await (supabase as any).rpc('get_orders_by_phone', { _tenant_id: tenant.id, _phone: value });
      const list = (ords || []) as any[];
      if (list.length === 0) { setOrders([]); return; }
      const ids = list.map((o) => o.id);
      const { data: items } = await supabase.from('order_items').select('*').in('order_id', ids);
      const byOrder: Record<string, any[]> = {};
      (items || []).forEach((it: any) => { (byOrder[it.order_id] ||= []).push(it); });
      const merged = list.map((o) => ({ ...o, order_items: byOrder[o.id] || [] }));
      setOrders((merged as OrderWithItems[]).filter(o => o.status !== CANCELLED_ORDER_STATUS));
    } else {
      // Busca por prefixo do código → view pública (sem customer_phone)
      const clean = value.toLowerCase().replace(/[^0-9a-f]/g, '');
      const padLow = (clean + '00000000000000000000000000000000').slice(0, 32);
      const padHigh = (clean + 'ffffffffffffffffffffffffffffffff').slice(0, 32);
      const toUuid = (h: string) =>
        `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
      const { data: ords } = await (supabase as any)
        .from('orders_public').select('*')
        .eq('tenant_id', tenant.id)
        .gte('id', toUuid(padLow)).lte('id', toUuid(padHigh))
        .order('created_at', { ascending: false });
      const list = (ords || []) as any[];
      if (list.length === 0) { setOrders([]); return; }
      const ids = list.map((o) => o.id);
      const { data: items } = await supabase.from('order_items').select('*').in('order_id', ids);
      const byOrder: Record<string, any[]> = {};
      (items || []).forEach((it: any) => { (byOrder[it.order_id] ||= []).push(it); });
      const merged = list.map((o) => ({ ...o, order_items: byOrder[o.id] || [] }));
      setOrders((merged as OrderWithItems[]).filter(o => o.status !== CANCELLED_ORDER_STATUS));
    }
  }, [tenant]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const kind = detectSearchKind(query);
    if (kind === 'invalid') {
      setError('Digite um telefone (com DDD) ou o código do pedido (ex: 977532).');
      return;
    }
    const value = kind === 'phone' ? query.replace(/\D/g, '') : query.trim().replace(/^#/, '').toLowerCase();
    setLoading(true);
    setLastSearch({ kind, value });
    try {
      if (kind === 'phone') localStorage.setItem(`lastPhone:${slug}`, value);
      else localStorage.setItem(`lastCode:${slug}`, value);
    } catch { /* ignore */ }
    await fetchOrders(kind, value);
    setSearched(true);
    setLoading(false);
  };

  // Auto-carrega pedidos da última busca salva (prioriza telefone, fallback código)
  useEffect(() => {
    if (!tenant || !slug || searched) return;
    let savedPhone = '';
    let savedCode = '';
    try {
      savedPhone = localStorage.getItem(`lastPhone:${slug}`) || '';
      savedCode = localStorage.getItem(`lastCode:${slug}`) || '';
    } catch { /* ignore */ }
    if (savedPhone.length >= 10) {
      setQuery(savedPhone);
      setLastSearch({ kind: 'phone', value: savedPhone });
      setLoading(true);
      fetchOrders('phone', savedPhone).finally(() => { setSearched(true); setLoading(false); });
    } else if (savedCode.length >= 6) {
      setQuery(savedCode);
      setLastSearch({ kind: 'code', value: savedCode });
      setLoading(true);
      fetchOrders('code', savedCode).finally(() => { setSearched(true); setLoading(false); });
    }
  }, [tenant, slug, searched, fetchOrders]);

  // Auto-refresh a cada 5 segundos após busca
  useEffect(() => {
    if (!searched || !lastSearch) return;
    const interval = setInterval(() => fetchOrders(lastSearch.kind, lastSearch.value), 5000);
    return () => clearInterval(interval);
  }, [searched, lastSearch, fetchOrders]);

  if (loadingTenant) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  if (!tenant) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Comércio não encontrado.</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
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
            <div className="flex flex-col leading-tight">
              <span className="font-heading text-lg text-foreground">{tenant.name}</span>
              <span className="text-xs text-muted-foreground">Meus Pedidos</span>
            </div>
          </div>
          <a href={`/loja/${slug}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="h-4 w-4" /> Loja
          </a>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-lg">
        <form onSubmit={handleSearch} className="space-y-3 mb-8">
          <label className="text-sm text-muted-foreground block">
            Digite seu <span className="text-foreground font-medium">telefone</span> ou o <span className="text-foreground font-medium">código do pedido</span> (ex: <span className="font-mono">#977532</span>):
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="(11) 91234-5678 ou 977532"
              className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              <Search className="h-4 w-4" /> Buscar
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {lastSearch && !error && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {lastSearch.kind === 'phone' ? <Phone className="h-3 w-3" /> : <Hash className="h-3 w-3" />}
              Buscando por {lastSearch.kind === 'phone' ? 'telefone' : 'código do pedido'}
            </p>
          )}
        </form>

        {loading && <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}
        {searched && !loading && orders.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum pedido encontrado.</p>}

        {orders.map(order => {
          const cfg = statusConfig[order.status] || statusConfig.received;
          return (
            <div key={order.id} className="rounded-lg border border-border bg-card p-4 space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground text-sm">#{order.id.slice(0, 6)}</span>
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString('pt-BR')}</span>
              </div>
              <div className="text-sm space-y-1">
                {order.order_items.map(i => (
                  <div key={i.id} className="flex justify-between text-muted-foreground">
                    <span>{i.quantity}x {i.product_name}</span>
                    <span>R${(i.product_price * i.quantity).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-foreground border-t border-border pt-1">
                  <span>Total</span>
                  <span className="text-primary">R${order.total.toFixed(2)}</span>
                </div>
              </div>
              {order.delivery_status_note && (
                <p className="text-xs text-yellow-400 flex items-center gap-1 pt-1">⚠️ {order.delivery_status_note}</p>
              )}
              {order.status === 'out-for-delivery' && order.delivery_type === 'delivery' && (() => {
                const trackUrl = order.external_tracking_url || order.lalamove_share_link;
                const isExternal = !!trackUrl;
                const href = trackUrl || `/loja/${slug}/pedido/${order.id}`;
                const label = order.external_tracking_url
                  ? `Acompanhar corrida${order.external_tracking_provider ? ` (${order.external_tracking_provider})` : ''}`
                  : order.lalamove_share_link
                    ? 'Acompanhar corrida no mapa'
                    : 'Acompanhar entrega';
                return (
                  <a
                    href={href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noreferrer' : undefined}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
                  >
                    <MapPin className="h-4 w-4" />
                    {label}
                  </a>
                );
              })()}
              {order.status !== 'delivered' && order.status !== 'cancelled' && tenant && (
                <CustomerOrderChat
                  order={{
                    id: order.id,
                    tenant_id: tenant.id,
                    customer_name: order.customer_name,
                    customer_phone: order.customer_phone || lastSearch?.value || '',
                  }}
                  tenantName={tenant.name}
                />
              )}
              <div className="flex items-center gap-1 pt-2">
              {(() => {
                  const isPickup = order.delivery_type === 'pickup';
                  const steps = isPickup
                    ? ['pending_payment', 'received', 'preparing', 'ready-for-pickup', 'delivered']
                    : ['pending_payment', 'received', 'preparing', 'out-for-delivery', 'delivered'];
                  const currentIdx = steps.indexOf(order.status);
                  return steps.map((s, idx) => {
                    const active = idx <= currentIdx;
                    return (
                      <div key={s} className="flex-1 flex flex-col items-center">
                        <div className={`h-2 w-full rounded-full ${active ? 'gradient-primary' : 'bg-secondary'}`} />
                        <span className={`text-[10px] mt-1 ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                          {statusConfig[s]?.label.split(' ')[0] || s}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TenantOrders;
