import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Truck, ExternalLink, Phone, MapPin, RefreshCw, Package, Bike, Send, ArrowLeftRight, AlertCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { logOrderEvent } from '@/lib/order-events';

type Driver = { id: string; name: string; phone: string; active: boolean };

type Order = {
  id: string;
  status: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  driver_id: string | null;
  supplier_id: string | null;
  lalamove_order_id: string | null;
  lalamove_status: string | null;
  lalamove_share_link: string | null;
  lalamove_driver_name: string | null;
  lalamove_driver_phone: string | null;
  lalamove_driver_plate: string | null;
  lalamove_price: number | null;
  lalamove_payer: string | null;
  order_items: { product_name: string }[];
};

type SupplierLalamove = {
  lalamove_api_key: string;
  lalamove_api_secret: string;
  lalamove_use_store_api: string;
};

type Props = {
  supplierId: string;
  tenantId: string;
  supplierName: string;
};

const SupplierDeliveriesPanel = ({ supplierId, tenantId, supplierName }: Props) => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tenantHasLalamove, setTenantHasLalamove] = useState(false);
  const [supplierLala, setSupplierLala] = useState<SupplierLalamove | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const { data: dDrivers } = await supabase
      .from('drivers').select('id, name, phone, active')
      .eq('tenant_id', tenantId).eq('active', true);
    setDrivers((dDrivers as Driver[]) || []);

    const { data: tenant } = await supabase
      .from('tenants').select('lalamove_enabled').eq('id', tenantId).single();
    setTenantHasLalamove(!!(tenant as { lalamove_enabled: boolean } | null)?.lalamove_enabled);

    const { data: sup } = await supabase
      .from('suppliers').select('lalamove_api_key, lalamove_api_secret, lalamove_use_store_api')
      .eq('id', supplierId).single();
    setSupplierLala((sup as any) || null);

    const { data: rawOrders } = await supabase
      .from('orders').select('*, order_items(product_name)')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false })
      .limit(50);
    setOrders((rawOrders as Order[]) || []);
  }, [tenantId, supplierId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const hasOwnApi = !!(supplierLala?.lalamove_api_key && supplierLala?.lalamove_api_secret);
  const storeApproved = supplierLala?.lalamove_use_store_api === 'approved';
  const canDispatch = hasOwnApi || (tenantHasLalamove && storeApproved);
  const credentialOrigin: 'own' | 'store' | null = hasOwnApi ? 'own' : (storeApproved && tenantHasLalamove ? 'store' : null);

  const dispatchLalamove = async (orderId: string) => {
    if (!canDispatch) {
      toast.error('Cadastre uma API Lalamove na aba "Lalamove" ou solicite acesso à da loja.');
      return;
    }
    setDispatchingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('request-lalamove-delivery', {
        body: { orderId, supplierId, calledBy: 'supplier' },
      });
      if (error || (data as { error?: string })?.error) {
        throw new Error((data as { error?: string })?.error || error?.message || 'Erro');
      }
      const d = data as { price?: number; shareLink?: string; payer?: string };
      const payer = d.payer === 'supplier' ? 'fornecedor' : 'loja';
      toast.success(`Lalamove acionada! R$${d.price || '?'} (paga: ${payer})`);
      await supabase.from('orders').update({ status: 'out-for-delivery', kds_status: 'done' } as any).eq('id', orderId);
      await logOrderEvent({
        order_id: orderId, tenant_id: tenantId,
        event_type: 'lalamove_dispatched_by_supplier',
        from_status: 'preparing', to_status: 'out-for-delivery',
        actor: 'supplier', actor_id: supplierId,
        description: `Fornecedor "${supplierName}" acionou Lalamove via API ${credentialOrigin === 'own' ? 'própria' : 'da loja'} (paga: ${payer})`,
        metadata: { payer: d.payer, share_link: d.shareLink, credential_origin: credentialOrigin },
      });
      fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha: ${msg}`);
    } finally {
      setDispatchingId(null);
    }
  };

  const assignDriver = async (orderId: string, driverId: string) => {
    await supabase.from('orders').update({
      driver_id: driverId,
      status: 'out-for-delivery',
      lalamove_order_id: null, lalamove_status: null, lalamove_share_link: null,
      lalamove_driver_name: null, lalamove_driver_phone: null, lalamove_driver_plate: null,
    } as any).eq('id', orderId);
    const driver = drivers.find(d => d.id === driverId);
    await logOrderEvent({
      order_id: orderId, tenant_id: tenantId,
      event_type: 'driver_assigned_by_supplier',
      to_status: 'out-for-delivery', actor: 'supplier', actor_id: supplierId,
      description: `Fornecedor "${supplierName}" atribuiu motoboy "${driver?.name || ''}"`,
    });
    toast.success(`Motoboy ${driver?.name} atribuído!`);
    fetchData();
  };

  const refreshLalamove = async (orderId: string) => {
    setRefreshingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('lalamove-order-status', { body: { orderId } });
      if (error || (data as { error?: string })?.error) {
        throw new Error((data as { error?: string })?.error || error?.message || 'Erro');
      }
      toast.success(`Status: ${(data as { status?: string }).status || 'atualizado'}`);
      fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha: ${msg}`);
    } finally {
      setRefreshingId(null);
    }
  };

  const cancelLalamove = async (orderId: string) => {
    if (!confirm('Cancelar a corrida na Lalamove? O pedido voltará para "Em preparo".')) return;
    setCancellingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-lalamove-delivery', {
        body: { orderId, revertStatus: 'preparing' },
      });
      if (error || (data as { error?: string })?.error) {
        throw new Error((data as { error?: string })?.error || error?.message || 'Erro');
      }
      await logOrderEvent({
        order_id: orderId, tenant_id: tenantId,
        event_type: 'lalamove_cancelled_by_supplier',
        from_status: 'out-for-delivery', to_status: 'preparing',
        actor: 'supplier', actor_id: supplierId,
        description: `Fornecedor "${supplierName}" cancelou corrida Lalamove`,
      });
      toast.success('Corrida cancelada na Lalamove');
      fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao cancelar: ${msg}`);
    } finally {
      setCancellingId(null);
    }
  };

  const activeOrders = orders.filter(o => ['received', 'preparing', 'out-for-delivery'].includes(o.status));
  const pendingDispatch = activeOrders.filter(o => !o.lalamove_order_id && !o.driver_id && o.status !== 'received');
  const lalamoveActive = activeOrders.filter(o => o.lalamove_order_id);
  const driverActive = activeOrders.filter(o => o.driver_id && !o.lalamove_order_id);

  return (
    <div className="space-y-6">
      {/* Aviso sobre disponibilidade Lalamove */}
      {!canDispatch && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium mb-1">Lalamove indisponível</p>
            <p>Vá na aba <strong>"Lalamove"</strong> e cadastre sua API ou solicite acesso à API da loja.
            Por enquanto, você só pode atribuir motoboys.</p>
          </div>
        </div>
      )}
      {canDispatch && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-400">
          ✅ Lalamove disponível — usando API {credentialOrigin === 'own' ? 'própria (você paga)' : 'da loja (loja paga)'}
        </div>
      )}

      {/* Pedidos prontos pra despachar */}
      <div>
        <h3 className="font-heading text-foreground mb-2 flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          Pedidos prontos pra despachar
          {pendingDispatch.length > 0 && (
            <span className="rounded-full bg-primary/20 text-primary text-xs font-bold px-2 py-0.5">{pendingDispatch.length}</span>
          )}
        </h3>
        {pendingDispatch.length === 0 && (
          <p className="text-center text-muted-foreground py-4 text-sm">Nenhum pedido aguardando despacho.</p>
        )}
        {pendingDispatch.map(o => (
          <div key={o.id} className="rounded-lg border border-border bg-card p-4 space-y-3 mb-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground text-sm">#{o.id.slice(0, 6)} · {o.customer_name}</span>
              <span className="text-xs text-muted-foreground">{o.customer_phone}</span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {o.customer_address}
            </p>

            {drivers.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Bike className="h-3 w-3" /> Motoboy próprio:</p>
                <div className="flex flex-wrap gap-1">
                  {drivers.map(d => (
                    <button key={d.id} onClick={() => assignDriver(o.id, d.id)}
                      className="rounded-md bg-secondary text-foreground px-2 py-1 text-xs hover:bg-primary/20">
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {canDispatch && (
              <div className="space-y-2 rounded-md bg-orange-500/5 border border-orange-500/20 p-2">
                <p className="text-xs text-orange-400 flex items-center gap-1 font-medium">
                  <Truck className="h-3 w-3" /> Despachar pela Lalamove
                  <span className="text-muted-foreground ml-auto">
                    {credentialOrigin === 'own' ? '(você paga)' : '(loja paga)'}
                  </span>
                </p>
                <button onClick={() => dispatchLalamove(o.id)} disabled={dispatchingId === o.id}
                  className="w-full rounded-lg bg-orange-500/20 text-orange-400 px-3 py-2 text-xs font-medium hover:bg-orange-500/30 disabled:opacity-50 flex items-center justify-center gap-1">
                  <Send className="h-3 w-3" />
                  {dispatchingId === o.id ? 'Acionando...' : 'Acionar Lalamove'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {driverActive.length > 0 && (
        <div>
          <h3 className="font-heading text-foreground mb-2 flex items-center gap-2">
            <Bike className="h-4 w-4 text-primary" />
            Em entrega — Motoboy próprio ({driverActive.length})
          </h3>
          {driverActive.map(o => {
            const driver = drivers.find(d => d.id === o.driver_id);
            return (
              <div key={o.id} className="rounded-lg border border-border bg-card p-3 mb-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground text-sm">#{o.id.slice(0, 6)} · {o.customer_name}</span>
                  <span className="text-xs text-primary">🏍️ {driver?.name || 'Motoboy'}</span>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {o.customer_address}
                </p>
                {canDispatch && (
                  <div className="rounded-md bg-orange-500/5 border border-orange-500/20 p-2 space-y-1">
                    <p className="text-xs text-orange-400 flex items-center gap-1">
                      <ArrowLeftRight className="h-3 w-3" /> Trocar para Lalamove?
                      <span className="text-muted-foreground ml-auto">
                        {credentialOrigin === 'own' ? '(você paga)' : '(loja paga)'}
                      </span>
                    </p>
                    <button onClick={() => dispatchLalamove(o.id)} disabled={dispatchingId === o.id}
                      className="w-full rounded-lg bg-orange-500/20 text-orange-400 px-3 py-1.5 text-xs hover:bg-orange-500/30 disabled:opacity-50">
                      {dispatchingId === o.id ? 'Acionando...' : 'Trocar para Lalamove'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div>
        <h3 className="font-heading text-foreground mb-2 flex items-center gap-2">
          <Truck className="h-4 w-4 text-orange-400" />
          Corridas Lalamove
          {lalamoveActive.length > 0 && (
            <span className="rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold px-2 py-0.5">{lalamoveActive.length} ativa(s)</span>
          )}
        </h3>
        {lalamoveActive.length === 0 && (
          <p className="text-center text-muted-foreground py-4 text-sm">Nenhuma corrida Lalamove em andamento.</p>
        )}
        {lalamoveActive.map(o => (
          <div key={o.id} className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4 space-y-2 mb-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground text-sm">#{o.id.slice(0, 6)} · {o.customer_name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium">
                {o.lalamove_status || 'Em andamento'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {o.customer_address}
            </p>
            {o.lalamove_driver_name && (
              <div className="text-xs text-muted-foreground space-y-0.5 rounded-md bg-card p-2 border border-border">
                <p className="text-foreground font-medium">🏍️ {o.lalamove_driver_name}</p>
                {o.lalamove_driver_phone && (
                  <p className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {o.lalamove_driver_phone}
                    {o.lalamove_driver_plate && <span className="ml-2">· Placa {o.lalamove_driver_plate}</span>}
                  </p>
                )}
              </div>
            )}
            {o.lalamove_price && (
              <p className="text-xs text-muted-foreground">
                💰 Custo: R${Number(o.lalamove_price).toFixed(2)}
                {o.lalamove_payer === 'supplier' && <span className="ml-2 text-yellow-400">(você paga)</span>}
                {o.lalamove_payer === 'store' && <span className="ml-2 text-green-400">(loja paga)</span>}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              {o.lalamove_share_link && (
                <a href={o.lalamove_share_link} target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-orange-500/20 text-orange-400 px-3 py-2 text-xs font-medium hover:bg-orange-500/30">
                  <ExternalLink className="h-3 w-3" /> Acompanhar no mapa
                </a>
              )}
              <button onClick={() => refreshLalamove(o.id)} disabled={refreshingId === o.id}
                className="flex items-center justify-center gap-1 rounded-lg bg-secondary text-foreground px-3 py-2 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50">
                <RefreshCw className={`h-3 w-3 ${refreshingId === o.id ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
              <button onClick={() => cancelLalamove(o.id)} disabled={cancellingId === o.id}
                className="flex items-center justify-center gap-1 rounded-lg bg-red-500/15 text-red-400 px-3 py-2 text-xs font-medium hover:bg-red-500/25 disabled:opacity-50">
                <X className="h-3 w-3" />
                {cancellingId === o.id ? 'Cancelando...' : 'Cancelar'}
              </button>
            </div>
            {drivers.length > 0 && (
              <div className="rounded-md bg-card border border-border p-2 mt-2 space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowLeftRight className="h-3 w-3" /> Trocar para motoboy próprio:</p>
                <div className="flex flex-wrap gap-1">
                  {drivers.map(d => (
                    <button key={d.id} onClick={() => assignDriver(o.id, d.id)}
                      className="rounded-md bg-secondary text-foreground px-2 py-1 text-xs hover:bg-primary/20">
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-heading text-foreground mb-2 flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          Motoboys disponíveis na loja
        </h3>
        {drivers.length === 0 && (
          <p className="text-center text-muted-foreground py-4 text-sm">Nenhum motoboy cadastrado pela loja.</p>
        )}
        {drivers.map(d => (
          <div key={d.id} className="rounded-lg border border-border bg-card p-3 mb-2 flex items-center justify-between">
            <div>
              <span className="font-medium text-foreground text-sm">{d.name}</span>
              {d.phone && <span className="text-xs text-muted-foreground ml-2">📞 {d.phone}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SupplierDeliveriesPanel;
