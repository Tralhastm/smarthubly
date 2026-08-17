import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  formatBatchMessage,
  formatOrderMessage,
  openWhatsAppToConsultora,
  downloadTxt,
  downloadBatchPdf,
  type AddressSource,
  type OrderForConsultora,
} from '@/lib/dropshipping-whatsapp';
import { notifyCustomerOnStatus } from '@/lib/whatsapp-customer';
import {
  Send,
  FileDown,
  FileText,
  RefreshCw,
  CheckCircle2,
  MapPin,
  User,
  Phone,
  MessageCircle,
  Package,
} from 'lucide-react';

type Tenant = {
  id: string;
  name: string;
  whatsapp_consultora_phone: string;
  whatsapp_default_address_source: AddressSource;
  whatsapp_store_address: string;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'received', label: 'Recebido' },
  { value: 'preparing', label: 'Preparando' },
  { value: 'out-for-delivery', label: 'Saiu para entrega' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'cancelled', label: 'Cancelado' },
];

const TenantAdminDropshippingWhatsApp = ({ tenantId }: { tenantId: string }) => {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [orders, setOrders] = useState<OrderForConsultora[]>([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<Record<string, AddressSource>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'pending' | 'sent' | 'all'>('pending');

  const load = async () => {
    setLoading(true);
    const [{ data: tenantData }, { data: orderData }, { data: productData }] = await Promise.all([
      supabase
        .from('tenants')
        .select('id, name, whatsapp_consultora_phone, whatsapp_default_address_source, whatsapp_store_address')
        .eq('id', tenantId)
        .single(),
      supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('products')
        .select('name, original_price')
        .eq('tenant_id', tenantId),
    ]);
    if (tenantData) setTenant(tenantData as any);
    // Mapa nome -> custo (original_price)
    const costByName = new Map<string, number>();
    ((productData as any[]) || []).forEach((p: any) => {
      if (p?.name && Number(p.original_price) > 0) costByName.set(p.name, Number(p.original_price));
    });
    const list = ((orderData as any[]) || []).map((o: any) => ({
      ...o,
      order_items: (o.order_items || []).map((i: any) => ({
        ...i,
        cost_price: costByName.get(i.product_name) ?? null,
      })),
    })) as OrderForConsultora[];
    setOrders(list);
    const defaultSrc: AddressSource =
      ((tenantData as any)?.whatsapp_default_address_source as AddressSource) || 'customer';
    const map: Record<string, AddressSource> = {};
    list.forEach(o => {
      map[o.id] = (o.whatsapp_address_source as AddressSource) || defaultSrc;
    });
    setSources(map);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [tenantId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'sent') return orders.filter(o => !!o.whatsapp_sent_at);
    // "Pendentes" = todos não cancelados/entregues, INCLUINDO já enviados
    // (assim o lojista mantém controle e não dá baixa automática).
    return orders.filter(o => o.status !== 'cancelled' && o.status !== 'delivered');
  }, [orders, filter]);

  const setSrc = (orderId: string, src: AddressSource) => {
    setSources(prev => ({ ...prev, [orderId]: src }));
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(filtered.map(o => o.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const markAsSent = async (orderIds: string[], batchId?: string) => {
    if (orderIds.length === 0) return;
    await Promise.all(
      orderIds.map(id =>
        supabase
          .from('orders')
          .update({
            whatsapp_sent_at: new Date().toISOString(),
            whatsapp_address_source: sources[id] || 'customer',
            ...(batchId ? { whatsapp_batch_id: batchId } : {}),
          } as any)
          .eq('id', id),
      ),
    );
  };

  const sendOne = async (order: OrderForConsultora) => {
    if (!tenant?.whatsapp_consultora_phone) {
      toast.error('Configure o número da consultora em Aparência → Modo loja');
      return;
    }
    const msg = formatOrderMessage(
      order,
      sources[order.id] || 'customer',
      tenant.whatsapp_store_address,
      tenant.name,
    );
    openWhatsAppToConsultora(tenant.whatsapp_consultora_phone, msg);
    await markAsSent([order.id]);
    toast.success('WhatsApp aberto. Marquei como enviado.');
    load();
  };

  const sendBatch = async () => {
    if (!tenant?.whatsapp_consultora_phone) {
      toast.error('Configure o número da consultora primeiro');
      return;
    }
    const batch = orders.filter(o => selected.has(o.id));
    if (batch.length === 0) {
      toast.error('Selecione ao menos 1 pedido');
      return;
    }
    const msg = formatBatchMessage(batch, sources, tenant.whatsapp_store_address, tenant.name);
    openWhatsAppToConsultora(tenant.whatsapp_consultora_phone, msg);
    const batchId = crypto.randomUUID();
    await markAsSent(batch.map(o => o.id), batchId);
    toast.success(`Lote de ${batch.length} pedidos enviado.`);
    clearSelection();
    load();
  };

  const exportPdf = () => {
    if (!tenant) return;
    const batch = selected.size > 0 ? orders.filter(o => selected.has(o.id)) : filtered;
    if (batch.length === 0) {
      toast.error('Nada pra exportar');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBatchPdf(
      `pedidos-consultora-${stamp}.pdf`,
      batch,
      sources,
      tenant.whatsapp_store_address,
      tenant.name,
    );
    toast.success('PDF gerado.');
  };

  const exportTxt = () => {
    if (!tenant) return;
    const batch = selected.size > 0 ? orders.filter(o => selected.has(o.id)) : filtered;
    if (batch.length === 0) {
      toast.error('Nada pra exportar');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const txt = formatBatchMessage(batch, sources, tenant.whatsapp_store_address, tenant.name);
    downloadTxt(`pedidos-consultora-${stamp}.txt`, txt);
    toast.success('TXT gerado.');
  };

  const updateStatus = async (order: OrderForConsultora, status: string) => {
    const kds = (await import('@/hooks/useOrders')).kdsPatchForStatus(status) || {};
    await supabase.from('orders').update({ status, ...kds }).eq('id', order.id);
    toast.success('Status atualizado. Cliente será notificado por e-mail automaticamente.');
    load();
  };

  const notifyCustomerWhatsApp = (order: OrderForConsultora) => {
    if (!order.customer_phone) {
      toast.error('Cliente sem telefone cadastrado');
      return;
    }
    const ok = notifyCustomerOnStatus(
      order.status,
      order.id,
      order.customer_phone,
      tenant?.name || 'Loja',
    );
    if (!ok) toast.error('Status sem mensagem padrão configurada');
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground p-4">Carregando…</div>;
  }

  if (!tenant?.whatsapp_consultora_phone) {
    return (
      <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4 space-y-2">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
          <MessageCircle className="w-4 h-4" /> Configure a consultora primeiro
        </h3>
        <p className="text-xs text-muted-foreground">
          Vá em <strong>Aparência → Modo loja</strong> e preencha o número da consultora WhatsApp e
          (opcionalmente) o endereço da loja.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header com KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">A enviar</p>
          <p className="text-2xl font-bold text-foreground">
            {orders.filter(o => !o.whatsapp_sent_at && o.status !== 'cancelled').length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Já enviados</p>
          <p className="text-2xl font-bold text-foreground">
            {orders.filter(o => !!o.whatsapp_sent_at).length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Selecionados</p>
          <p className="text-2xl font-bold text-primary">{selected.size}</p>
        </div>
      </div>

      {/* Filtros + ações em lote */}
      <div className="flex flex-wrap gap-2 items-center justify-between rounded-lg border border-border bg-card p-3">
        <div className="flex gap-1">
          {(['pending', 'sent', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'pending' ? 'Em andamento' : f === 'sent' ? 'Enviados' : 'Todos'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={selectAllVisible}
            className="px-2 py-1 rounded-md text-xs bg-secondary text-foreground hover:bg-secondary/70"
          >
            Selecionar todos
          </button>
          {selected.size > 0 && (
            <button
              onClick={clearSelection}
              className="px-2 py-1 rounded-md text-xs bg-secondary text-foreground hover:bg-secondary/70"
            >
              Limpar
            </button>
          )}
          <button
            onClick={sendBatch}
            disabled={selected.size === 0}
            className="px-3 py-1 rounded-md text-xs bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 flex items-center gap-1"
          >
            <Send className="w-3 h-3" /> Enviar lote ({selected.size})
          </button>
          <button
            onClick={exportPdf}
            className="px-3 py-1 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1"
          >
            <FileDown className="w-3 h-3" /> PDF
          </button>
          <button
            onClick={exportTxt}
            className="px-3 py-1 rounded-md text-xs bg-secondary text-foreground hover:bg-secondary/70 flex items-center gap-1"
          >
            <FileText className="w-3 h-3" /> TXT
          </button>
          <button
            onClick={load}
            className="px-2 py-1 rounded-md text-xs bg-secondary text-foreground hover:bg-secondary/70"
            title="Atualizar"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Lista de pedidos */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhum pedido nessa visão.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(order => {
            const src = sources[order.id] || 'customer';
            const isSent = !!order.whatsapp_sent_at;
            const isSelected = selected.has(order.id);
            return (
              <div
                key={order.id}
                className={`rounded-lg border bg-card p-3 space-y-2 transition-colors ${
                  isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(order.id)}
                      className="mt-1 w-4 h-4 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{order.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="text-sm font-medium text-foreground flex items-center gap-1">
                          <User className="w-3 h-3" /> {order.customer_name || '—'}
                        </span>
                        {isSent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> enviado
                          </span>
                        )}
                      </div>
                      {order.customer_phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3" /> {order.customer_phone}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Package className="w-3 h-3" /> {(order.order_items || []).length} item(s) ·{' '}
                        <strong>
                          custo: R${' '}
                          {(order.order_items || [])
                            .reduce((s, i: any) => {
                              const u = i.cost_price != null && i.cost_price > 0 ? Number(i.cost_price) : Number(i.product_price);
                              return s + u * i.quantity;
                            }, 0)
                            .toFixed(2)
                            .replace('.', ',')}
                        </strong>
                      </p>
                    </div>
                  </label>
                  <select
                    value={order.status}
                    onChange={e => updateStatus(order, e.target.value)}
                    className="text-xs rounded-md border border-border bg-secondary px-2 py-1 text-foreground"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-1 text-xs">
                    <MapPin className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Endereço:</span>
                    <button
                      onClick={() => setSrc(order.id, 'customer')}
                      className={`px-2 py-0.5 rounded text-[10px] ${
                        src === 'customer'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      do cliente
                    </button>
                    <button
                      onClick={() => setSrc(order.id, 'store')}
                      className={`px-2 py-0.5 rounded text-[10px] ${
                        src === 'store'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      meu (loja)
                    </button>
                  </div>
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => notifyCustomerWhatsApp(order)}
                      className="px-2 py-1 rounded-md text-xs bg-green-600/10 text-green-600 hover:bg-green-600/20 flex items-center gap-1"
                      title="Avisar cliente do status atual via WhatsApp"
                    >
                      <MessageCircle className="w-3 h-3" /> avisar cliente
                    </button>
                    <button
                      onClick={() => sendOne(order)}
                      className="px-2 py-1 rounded-md text-xs bg-green-600 text-white hover:bg-green-700 flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" /> enviar pra consultora
                    </button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground/80 truncate">
                  📍 {src === 'store' ? tenant.whatsapp_store_address || '— sem endereço da loja —' : order.delivery_address || '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TenantAdminDropshippingWhatsApp;
