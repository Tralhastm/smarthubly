import { useState, useEffect, useRef } from 'react';
import { useOrders, useUpdateOrderStatus, useDeleteOrder, type OrderWithItems } from '@/hooks/useOrders';
import { parseAddress } from '@/lib/address-utils';
import { useDrivers } from '@/hooks/useDrivers';
import { supabase } from '@/integrations/supabase/client';
import { Package, Clock, ChefHat, Truck, CheckCircle, MapPin, Trash2, User, Bell, History, MessageCircle, Printer, BellOff, BellRing } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { logOrderEvent } from '@/lib/order-events';
import OrderTimeline from './OrderTimeline';
import { notifyCustomerOnStatus } from '@/lib/whatsapp-customer';
import { startLoudAlert, stopAlert, playShortBeep, unlockAudio, isAlertPlaying } from '@/lib/order-alert-sound';
import { printOrder } from '@/lib/order-print';
import { isPrinterPaired } from '@/lib/printer-bluetooth';
import { isSimulationMode } from '@/lib/printer-simulator';
import { registerTenantAdminPush, getNotificationPermission, isPushSupported } from '@/lib/push-notifications';
import OrderEmitNFCeButton from './OrderEmitNFCeButton';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

const statusConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending_review: { label: 'Aguardando Aprovação', icon: <Clock className="h-4 w-4" />, color: 'bg-purple-500/20 text-purple-400' },
  received: { label: 'Recebido', icon: <Clock className="h-4 w-4" />, color: 'bg-blue-500/20 text-blue-400' },
  preparing: { label: 'Em Preparo', icon: <ChefHat className="h-4 w-4" />, color: 'bg-yellow-500/20 text-yellow-400' },
  'out-for-delivery': { label: 'Saiu para Entrega', icon: <Truck className="h-4 w-4" />, color: 'bg-orange-500/20 text-orange-400' },
  'ready-for-pickup': { label: 'Pronto p/ Retirada', icon: <Package className="h-4 w-4" />, color: 'bg-cyan-500/20 text-cyan-400' },
  delivered: { label: 'Entregue', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-green-500/20 text-green-400' },
  cancelled: { label: 'Cancelado', icon: <Trash2 className="h-4 w-4" />, color: 'bg-red-500/20 text-red-400' },
};

const fallbackStatus = { label: 'Desconhecido', icon: <Clock className="h-4 w-4" />, color: 'bg-muted text-muted-foreground' };

// Status flow depends on delivery_type of the order itself (not the store mode)
const getNext = (current: string, deliveryType: string): string | null => {
  const isPickup = deliveryType === 'pickup';
  const flow: Record<string, string | null> = isPickup
    ? {
        pending_review: 'received',
        received: 'preparing',
        preparing: 'ready-for-pickup',
        'ready-for-pickup': 'delivered',
        delivered: null,
      }
    : {
        pending_review: 'received',
        received: 'preparing',
        preparing: 'out-for-delivery',
        'out-for-delivery': 'delivered',
        delivered: null,
      };
  return flow[current] ?? null;
};

const TenantAdminOrders = ({ tenantId, tenantName = 'nossa loja' }: { tenantId: string; tenantName?: string }) => {
  const { data: orders = [], isLoading } = useOrders(tenantId);
  const { data: drivers = [] } = useDrivers(tenantId);
  const updateStatus = useUpdateOrderStatus();
  const deleteOrder = useDeleteOrder();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const [selectingDriver, setSelectingDriver] = useState<string | null>(null);
  const [choosingDispatch, setChoosingDispatch] = useState<string | null>(null);
  const [lalamoveEnabled, setLalamoveEnabled] = useState(false);
  const [advancingOrder, setAdvancingOrder] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState<string | null>(null);
  const [suggestExternalFor, setSuggestExternalFor] = useState<string | null>(null);
  const [printerCfg, setPrinterCfg] = useState<{ enabled: boolean; mode: string; soundOn: boolean; soundLoud: boolean; tenant: any } | null>(null);
  const [alertActive, setAlertActive] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(getNotificationPermission());
  const prevOrderCountRef = useRef(orders.length);
  const printedIdsRef = useRef<Set<string>>(new Set());

  const handleEnablePush = async () => {
    const ok = await registerTenantAdminPush(tenantId);
    if (ok) {
      toast.success('🔔 Notificações ativadas! Você receberá pedidos novos mesmo com a aba fechada.');
      setPushPermission('granted');
    } else {
      toast.error('Não foi possível ativar. Verifique se autorizou notificações no navegador.');
      setPushPermission(getNotificationPermission());
    }
  };

  // Carrega config (Lalamove + impressora + som)
  useEffect(() => {
    if (!tenantId) return;
    supabase.from('tenants').select('*').eq('id', tenantId).single()
      .then(({ data }) => {
        if (!data) return;
        const t = data as any;
        setLalamoveEnabled(!!t.lalamove_enabled);
        setPrinterCfg({
          enabled: !!t.printer_enabled,
          mode: t.printer_mode || 'manual',
          soundOn: t.sound_alert_enabled ?? true,
          soundLoud: t.sound_alert_loud ?? true,
          tenant: t,
        });
      });
  }, [tenantId]);

  // Desbloquear áudio no primeiro clique (browsers exigem)
  useEffect(() => {
    const handler = () => { unlockAudio(); window.removeEventListener('click', handler); };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Real-time: novos pedidos → som + auto-print
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`orders-${tenantId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const newOrder = payload.new as any;
          if (printerCfg?.soundOn) {
            if (printerCfg.soundLoud) { startLoudAlert(); setAlertActive(true); }
            else playShortBeep();
          }
          toast.success(`🔔 Novo pedido de ${newOrder.customer_name}!`, { duration: 8000 });
          queryClient.invalidateQueries({ queryKey: ['orders', tenantId] });

          if (printerCfg?.enabled && (printerCfg.mode === 'auto' || printerCfg.mode === 'both') && isPrinterPaired()) {
            setTimeout(async () => {
              if (printedIdsRef.current.has(newOrder.id)) return;
              printedIdsRef.current.add(newOrder.id);
              try {
                const { data: full } = await supabase.from('orders').select('*, order_items(*)').eq('id', newOrder.id).single();
                if (full) await printOrder(full as any, printerCfg.tenant);
              } catch (e: any) {
                toast.error(`Falha ao imprimir automaticamente: ${e.message}`);
              }
            }, 1500);
          }
        }
      )
      .subscribe((status) => {
        // Gap-fill: ao (re)conectar, busca tudo que mudou com o socket caído
        if (status === 'SUBSCRIBED') {
          queryClient.invalidateQueries({ queryKey: ['orders', tenantId] });
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, queryClient, printerCfg]);

  const handleManualPrint = async (order: OrderWithItems) => {
    if (!printerCfg?.tenant) { toast.error('Configuração de impressora não carregada. Recarregue a página.'); return; }
    const sim = isSimulationMode();
    if (!sim && !isPrinterPaired()) {
      toast.error('Pareie uma impressora na aba Impressora primeiro — ou ative o Modo Simulação para testar.');
      return;
    }
    const toastId = toast.loading(sim ? 'Gerando simulação...' : 'Enviando para impressora...');
    try {
      await printOrder(order as any, printerCfg.tenant);
      toast.success(sim ? '✅ Janela de simulação aberta' : '✅ Cupom enviado para a impressora', { id: toastId });
    } catch (e: any) {
      toast.error(`❌ Falha: ${e.message}`, { id: toastId, duration: 6000 });
    }
  };

  const dismissAlert = () => { stopAlert(); setAlertActive(false); };

  // Fallback: detect new orders via polling data changes
  useEffect(() => {
    if (orders.length > prevOrderCountRef.current && prevOrderCountRef.current > 0) {
      // Already handled by realtime, just update ref
    }
    prevOrderCountRef.current = orders.length;
  }, [orders.length]);

  const handleNext = async (id: string, current: string, deliveryType: string) => {
    const next = getNext(current, deliveryType);
    if (!next || advancingOrder) return;

    if (next === 'out-for-delivery') {
      const activeDrivers = drivers.filter(d => d.active);
      // Sempre abre o seletor: recomenda Uber/99 (rastreio externo) como 1ª opção
      // Motoboy próprio e Lalamove ficam como alternativas
      if (activeDrivers.length > 0 || lalamoveEnabled) {
        setChoosingDispatch(id);
        return;
      }
      // Sem nenhuma opção configurada → sugere colar link externo
      setSuggestExternalFor(id);
      toast.info('Recomendamos chamar pelo Uber Entrega ou 99 e colar o link de rastreio.');
      return;
    }

    if (next === 'delivered') {
      if (!confirm('Confirmar entrega do pedido?')) return;
    }

    setAdvancingOrder(id);
    queryClient.setQueryData<OrderWithItems[]>(['orders', tenantId], (old) =>
      old?.map(o => o.id === id ? { ...o, status: next } : o)
    );
    updateStatus.mutate({ id, status: next }, {
      onSuccess: () => {
        toast.success(`✅ Pedido #${id.slice(0, 6)} → ${statusConfig[next]?.label ?? next}`);
        // Auto-switch filter to the new status so the order doesn't "disappear"
        if (filter !== 'all' && filter === current) {
          setFilter(next);
        }
        logOrderEvent({
          order_id: id,
          tenant_id: tenantId,
          event_type: 'status_change',
          from_status: current,
          to_status: next,
          actor: 'admin',
          description: current === 'pending_review' ? 'Admin aprovou o pedido' : 'Admin avançou status manualmente',
        });
      },
      onError: (err) => {
        toast.error(`Erro ao avançar: ${err.message}`);
      },
      onSettled: () => setAdvancingOrder(null),
    });
  };

  const assignDriverAndDispatch = async (orderId: string, driverId: string) => {
    const { error } = await supabase.from('orders').update({ status: 'out-for-delivery', driver_id: driverId, kds_status: 'done' } as any).eq('id', orderId);
    if (error) {
      toast.error(`Erro ao despachar: ${error.message}`);
      return;
    }
    queryClient.setQueryData<OrderWithItems[]>(['orders', tenantId], (old) =>
      old?.map(o => o.id === orderId ? { ...o, status: 'out-for-delivery', driver_id: driverId } : o)
    );
    setSelectingDriver(null);
    toast.success('Pedido despachado com motoboy!');
    queryClient.invalidateQueries({ queryKey: ['orders', tenantId] });

    // Send push notification to driver
    const order = orders.find(o => o.id === orderId);
    try {
      await unifiedInvoke("notify-unified", "push", {
          driverId,
          title: '🏍️ Nova entrega!',
          body: `Pedido #${orderId.slice(0, 6)} - ${order?.customer_name || 'Cliente'} - ${order?.customer_address || ''}`,
        });
    } catch (e) {
      console.error('Push notification failed:', e);
    }
  };

  const dispatchLalamove = async (orderId: string) => {
    setChoosingDispatch(null);
    setAdvancingOrder(orderId);
    const toastId = toast.loading('Chamando Lalamove... (até 30s)');
    try {
      // Race com timeout de 30s — se demorar demais, sugere chamar por fora
      const invokePromise = unifiedInvoke("delivery-unified", "lalamove-request", { orderId, calledBy: 'admin' });
      const timeoutPromise = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('TIMEOUT: Lalamove demorou mais de 30s')), 30000)
      );
      const { data, error } = await Promise.race([invokePromise, timeoutPromise]) as any;
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || 'Erro Lalamove');
      await supabase.from('orders').update({ status: 'out-for-delivery', kds_status: 'done' } as any).eq('id', orderId);
      queryClient.invalidateQueries({ queryKey: ['orders', tenantId] });
      toast.success(`✅ Lalamove acionada! Preço: R$${(data as any).price || '?'}`, { id: toastId, duration: 6000 });
    } catch (e: any) {
      const isTimeout = /timeout/i.test(e.message || '');
      toast.error(
        isTimeout
          ? '⏱️ Lalamove demorou demais. Chame por fora (Uber Entrega/99) e cole o link de rastreio aqui embaixo ⬇️'
          : `Falha Lalamove: ${e.message}. Você pode chamar por fora e colar o link.`,
        { id: toastId, duration: 10000 }
      );
      // Abre automaticamente o editor de rastreio externo pra esse pedido
      setSuggestExternalFor(orderId);
    } finally {
      setAdvancingOrder(null);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm('Apagar este pedido?')) return;
    queryClient.setQueryData<OrderWithItems[]>(['orders', tenantId], (old) =>
      old?.filter(o => o.id !== id)
    );
    deleteOrder.mutate(id);
  };

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter);

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const activeDrivers = drivers.filter(d => d.active);

  return (
    <div className="space-y-4">
      {isPushSupported() && pushPermission !== 'granted' && (
        <button
          onClick={handleEnablePush}
          className="w-full rounded-xl border border-primary/40 bg-primary/10 p-3 flex items-center gap-3 hover:bg-primary/15 transition-colors text-left"
        >
          <div className="shrink-0 h-10 w-10 rounded-full bg-primary/20 text-primary flex items-center justify-center">
            <BellRing className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-primary">Ativar notificações de novos pedidos</p>
            <p className="text-xs text-muted-foreground">Receba alertas mesmo com o painel fechado.</p>
          </div>
          <span className="shrink-0 text-xs font-medium text-primary">Ativar →</span>
        </button>
      )}

      {alertActive && (
        <button onClick={dismissAlert}
          className="sticky top-2 z-20 w-full rounded-xl bg-orange-500 text-white py-3 font-bold animate-pulse flex items-center justify-center gap-2">
          🔔 NOVO PEDIDO! Clique para parar o som
        </button>
      )}

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {['all', 'pending_review', 'received', 'preparing', 'out-for-delivery', 'ready-for-pickup', 'delivered', 'cancelled'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium transition-all ${filter === s ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            {s === 'all' ? 'Todos' : statusConfig[s].label}
            {s === 'pending_review' && orders.filter(o => o.status === 'pending_review').length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-4 h-4">
                {orders.filter(o => o.status === 'pending_review').length}
              </span>
            )}
            {s === 'received' && orders.filter(o => o.status === 'received').length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold w-4 h-4">
                {orders.filter(o => o.status === 'received').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum pedido.</p>}

      {filtered.map(order => {
        const cfg = statusConfig[order.status] ?? fallbackStatus;
        const assignedDriver = drivers.find(d => d.id === order.driver_id);
        return (
          <div key={order.id} className={`rounded-lg border bg-card p-4 space-y-3 ${order.status === 'received' || order.status === 'pending_review' ? 'border-primary/50 animate-pulse-slow' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <span className="font-medium text-foreground text-sm">#{order.id.slice(0, 6)}</span>
                <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                  {cfg.icon} {cfg.label}
                </span>
                {order.status === 'received' && (
                  <span className="flex items-center gap-1 text-xs text-primary animate-pulse">
                    <Bell className="h-3 w-3" /> Novo!
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString('pt-BR')}</span>
                {order.customer_phone && (
                  <button
                    onClick={() => {
                      const ok = notifyCustomerOnStatus(order.status, order.id, order.customer_phone, tenantName);
                      if (!ok) toast.info('Sem mensagem pré-configurada para este status');
                    }}
                    title="Avisar cliente no WhatsApp"
                    className="text-[hsl(142,71%,45%)] hover:text-[hsl(142,71%,55%)]">
                    <MessageCircle className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => handleManualPrint(order)}
                  title="Imprimir cupom"
                  className="text-primary hover:text-primary/80">
                  <Printer className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(order.id)} className="text-destructive hover:text-destructive/80">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <p><strong className="text-foreground">{order.customer_name}</strong> · {order.customer_phone}</p>
              {order.delivery_type === 'delivery' && (() => {
                const { main, reference } = parseAddress(order.customer_address);
                return (
                  <div className="mt-1 space-y-1">
                    <p className="flex items-start gap-1"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span>{main}</span></p>
                    {reference && (
                      <p className="ml-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
                        📍 <strong>Referência:</strong> {reference}
                      </p>
                    )}
                  </div>
                );
              })()}
              {order.delivery_type === 'delivery' && order.distance != null && <p className="text-xs mt-0.5">📏 {order.distance} km · Taxa: R${order.delivery_fee.toFixed(2)}</p>}
              <p className="mt-1 flex items-center gap-2 flex-wrap">
                <span>{order.delivery_type === 'delivery' ? '🚗 Entrega' : '🏪 Retirada'} · 💳 <strong className="text-foreground">{order.payment_method}</strong></span>
                {(order as any).payment_received || /mercadopago/i.test(order.payment_method) ? (
                  <span className="rounded-full bg-green-500/20 text-green-400 px-2 py-0.5 text-[11px] font-bold">✅ PAGO</span>
                ) : (
                  <>
                    <span className="rounded-full bg-yellow-500/20 text-yellow-400 px-2 py-0.5 text-[11px] font-bold">
                      💵 PAGAR {order.delivery_type === 'delivery' ? 'NA ENTREGA' : 'NO BALCÃO'}
                    </span>
                    <button
                      onClick={async () => {
                        const { error } = await supabase.from('orders').update({ payment_received: true } as any).eq('id', order.id);
                        if (error) { toast.error('Erro ao confirmar'); return; }
                        toast.success('💰 Pagamento confirmado');
                        queryClient.invalidateQueries({ queryKey: ['orders', tenantId] });
                      }}
                      className="rounded-full bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/40 px-2 py-0.5 text-[11px] font-bold transition-colors"
                    >
                      ✓ Confirmar pagamento
                    </button>
                  </>
                )}
              </p>
              {(order as any).change_for > 0 && /dinheiro|cash/i.test(order.payment_method || '') && (
                <p className="text-xs mt-0.5 text-yellow-400 font-medium">💵 Troco para R${(order as any).change_for.toFixed(2)} (levar R${((order as any).change_for - order.total).toFixed(2)} de troco)</p>
              )}
              <p className="text-xs mt-0.5 text-primary">Taxa plataforma: R${order.platform_fee.toFixed(2)}</p>
              {assignedDriver && (
                <p className="text-xs mt-0.5 flex items-center gap-1 text-orange-400">
                  <User className="h-3 w-3" /> Motoboy: {assignedDriver.name}
                </p>
              )}
              {order.delivery_status_note && (
                <p className="text-xs mt-0.5 flex items-center gap-1 text-yellow-400">
                  ⚠️ Nota do motoboy: {order.delivery_status_note}
                </p>
              )}
              {order.status === 'cancelled' && (order as any).cancel_reason && (
                <p className="text-xs mt-0.5 text-red-400">
                  ✖ Motivo: {(order as any).cancel_reason === 'pending_payment_expired' ? 'Pagamento Pix expirado (cancelado automaticamente)' : (order as any).cancel_reason}
                </p>
              )}
              {(() => {
                const lOrderId = (order as any).lalamove_order_id;
                const lStatus = (order as any).lalamove_status;
                const extUrl = (order as any).external_tracking_url;
                const lalamoveActive = !!lOrderId && lStatus !== 'CANCELED' && !extUrl;
                const lalamoveReplaced = !!lOrderId && (lStatus === 'CANCELED' || !!extUrl);
                return (
                  <>
                    {lalamoveActive && (
                      <div className="text-xs mt-1 rounded-lg bg-orange-500/10 border border-orange-500/30 p-2 space-y-1">
                        <p className="text-orange-400 font-medium">🏍️ Lalamove: {lStatus || 'Em andamento'}</p>
                        {(order as any).lalamove_driver_name && (
                          <p className="text-muted-foreground">Motoboy: {(order as any).lalamove_driver_name} · {(order as any).lalamove_driver_phone} · Placa {(order as any).lalamove_driver_plate}</p>
                        )}
                        {(order as any).lalamove_price && <p className="text-muted-foreground">Custo Lalamove: R${Number((order as any).lalamove_price).toFixed(2)}</p>}
                        {(order as any).lalamove_share_link && (
                          <a href={(order as any).lalamove_share_link} target="_blank" rel="noreferrer" className="text-primary underline">Acompanhar entrega →</a>
                        )}
                        <button
                          onClick={() => setSuggestExternalFor(order.id)}
                          className="block w-full mt-1 rounded bg-secondary text-foreground px-2 py-1 text-xs hover:bg-secondary/80 border border-border"
                          title="Cancela a Lalamove e usa rastreio de Uber/99/etc"
                        >
                          🔁 Trocar p/ entrega externa (Uber, 99…)
                        </button>
                      </div>
                    )}
                    {lalamoveReplaced && (
                      <div className="text-xs mt-1 rounded-lg bg-secondary/40 border border-border p-2 text-muted-foreground">
                        Lalamove {lStatus === 'CANCELED' ? 'cancelada' : 'substituída'} — usando rastreio externo abaixo.
                      </div>
                    )}
                    {order.delivery_type === 'delivery' && (
                      <ExternalTrackingEditor
                        orderId={order.id}
                        initialUrl={extUrl || ''}
                        initialProvider={(order as any).external_tracking_provider || ''}
                        autoOpen={suggestExternalFor === order.id}
                        highlight={suggestExternalFor === order.id}
                        lalamoveActive={lalamoveActive}
                      />
                    )}
                  </>
                );
              })()}
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

            {order.status === 'delivered' && (
              <div className="pt-2">
                <OrderEmitNFCeButton orderId={order.id} tenantId={tenantId} orderStatus={order.status} />
              </div>
            )}

            {choosingDispatch === order.id && (
              <div className="rounded-lg border border-primary/30 bg-secondary p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">Como despachar este pedido?</p>

                {/* RECOMENDADO: Uber / 99 com link externo */}
                <button
                  onClick={() => { setChoosingDispatch(null); setSuggestExternalFor(order.id); }}
                  className="w-full flex items-center gap-2 rounded-lg bg-primary/10 border-2 border-primary p-2 text-sm text-foreground hover:bg-primary/20 transition-colors"
                >
                  <Truck className="h-4 w-4 text-primary" />
                  <span className="font-medium">Uber Entrega ou 99 (recomendado)</span>
                  <span className="text-[10px] uppercase tracking-wide bg-primary text-primary-foreground rounded px-1.5 py-0.5 ml-auto">melhor</span>
                </button>
                <p className="text-[11px] text-muted-foreground -mt-1 px-1">
                  Chame pelo app do Uber/99 e cole o link de rastreio aqui — o cliente acompanha sozinho e a responsabilidade fica com o app.
                </p>

                {activeDrivers.length > 0 && (
                  <button onClick={() => { setChoosingDispatch(null); setSelectingDriver(order.id); }}
                    className="w-full flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-sm text-foreground hover:border-primary transition-colors">
                    <User className="h-4 w-4 text-primary" />
                    <span>Motoboy próprio</span>
                    <span className="text-xs text-muted-foreground ml-auto">{activeDrivers.length} disponível(is)</span>
                  </button>
                )}

                {lalamoveEnabled && (
                  <button onClick={() => dispatchLalamove(order.id)}
                    disabled={advancingOrder === order.id}
                    className="w-full flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-sm text-muted-foreground hover:border-orange-500/50 hover:text-foreground transition-colors disabled:opacity-50">
                    <Truck className="h-4 w-4 text-orange-400" />
                    <span>Lalamove (alternativa)</span>
                    <span className="text-xs ml-auto">se Uber/99 não der</span>
                  </button>
                )}

                <button onClick={() => setChoosingDispatch(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
              </div>
            )}

            {selectingDriver === order.id && (
              <div className="rounded-lg border border-primary/30 bg-secondary p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">Escolha o motoboy:</p>
                {activeDrivers.map(d => (
                  <button key={d.id} onClick={() => assignDriverAndDispatch(order.id, d.id)}
                    className="w-full flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-sm text-foreground hover:border-primary transition-colors">
                    <Truck className="h-4 w-4 text-primary" />
                    <span>{d.name}</span>
                    <span className="text-xs text-muted-foreground">· {d.phone}</span>
                  </button>
                ))}
                <button onClick={() => setSelectingDriver(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
              </div>
            )}

            {(order as any).needs_fragmentation && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 mb-2 space-y-2">
                <div className="flex items-center gap-2 text-yellow-500 font-bold text-sm">
                  <Package className="h-4 w-4" />
                  Inteligência de Preços: Pedido Fragmentado
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  A IA detectou que este pedido pode ser otimizado comprando de múltiplos fornecedores pelo menor custo.
                </p>
                
                <div className="space-y-2 mt-2">
                  {Object.entries((order as any).metadata?.fragmentation_map || {}).map(([sid, itemNames]: [string, any]) => {
                    const supplier = (order as any).suppliers?.find((s: any) => s.id === sid);
                    return (
                      <div key={sid} className="rounded bg-background/50 p-2 border border-border/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-primary uppercase">{supplier?.name || 'Fornecedor Desconhecido'}</span>
                          <button 
                            onClick={() => {
                              const text = `Olá ${supplier?.name}, tenho um novo pedido fragmentado:\n\n` + 
                                itemNames.map((n: string) => `• ${n}`).join('\n') + 
                                `\n\nCliente: ${order.customer_name}\nEndereço: ${order.customer_address || 'Retirada'}`;
                              window.open(`https://wa.me/${supplier?.phone?.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank');
                            }}
                            className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded hover:bg-primary/30"
                          >
                            Enviar p/ WhatsApp
                          </button>
                        </div>
                        <ul className="text-[10px] text-foreground/80 space-y-0.5">
                          {itemNames.map((name: string, idx: number) => (
                            <li key={idx} className="flex items-center gap-1">
                              <div className="h-1 w-1 rounded-full bg-primary" /> {name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {order.status === 'out-for-delivery' && selectingDriver !== order.id && choosingDispatch !== order.id && (
              <div className="grid grid-cols-2 gap-2">
                {activeDrivers.length > 0 && (
                  <button onClick={() => setSelectingDriver(order.id)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-400 py-2 text-xs font-medium hover:bg-orange-500/20 transition-colors">
                    <User className="h-3 w-3" />
                    {assignedDriver ? `Trocar motoboy` : 'Motoboy próprio'}
                  </button>
                )}
                {lalamoveEnabled && !(order as any).lalamove_order_id && (
                  <button onClick={() => {
                    if (!confirm(assignedDriver ? `Trocar do motoboy ${assignedDriver.name} para Lalamove?` : 'Chamar Lalamove para este pedido?')) return;
                    dispatchLalamove(order.id);
                  }}
                    disabled={advancingOrder === order.id}
                    className="flex items-center justify-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-400 py-2 text-xs font-medium hover:bg-orange-500/20 transition-colors disabled:opacity-50">
                    <Truck className="h-3 w-3" />
                    {assignedDriver ? 'Trocar p/ Lalamove' : 'Chamar Lalamove'}
                  </button>
                )}
              </div>
            )}

            {getNext(order.status, order.delivery_type) && selectingDriver !== order.id && choosingDispatch !== order.id && (
              <button onClick={() => handleNext(order.id, order.status, order.delivery_type)}
                disabled={advancingOrder === order.id}
                className="w-full rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                {advancingOrder === order.id
                  ? (order.status === 'pending_review' ? 'Aprovando...' : 'Avançando...')
                  : (order.status === 'pending_review' ? 'Aprovar pedido' : `Avançar → ${statusConfig[getNext(order.status, order.delivery_type)!].label}`)}
              </button>
            )}

            <button onClick={() => setShowTimeline(showTimeline === order.id ? null : order.id)}
              className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary py-1">
              <History className="h-3 w-3" /> {showTimeline === order.id ? 'Ocultar' : 'Ver'} linha do tempo
            </button>
            {showTimeline === order.id && (
              <div className="rounded-lg bg-secondary p-3 mt-1">
                <OrderTimeline orderId={order.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Editor inline pra colar link de rastreio externo (Uber Entrega, 99, etc.)
const ExternalTrackingEditor = ({ orderId, initialUrl, initialProvider, autoOpen = false, highlight = false, lalamoveActive = false }: {
  orderId: string; initialUrl: string; initialProvider: string; autoOpen?: boolean; highlight?: boolean; lalamoveActive?: boolean;
}) => {
  const [open, setOpen] = useState(!!initialUrl || autoOpen);
  const [url, setUrl] = useState(initialUrl);
  const [provider, setProvider] = useState(initialProvider);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);

  const save = async () => {
    setSaving(true);

    // Se tem link, já avança o status pra "Saiu para Entrega" (quando ainda está em received/preparing).
    // Sem isso, o cliente vê "Em Preparo" mesmo com link colado — gerando a discrepância reportada.
    let advanced = false;
    if (url) {
      const { data: cur } = await supabase.from('orders').select('status, delivery_type').eq('id', orderId).maybeSingle();
      if (cur && cur.delivery_type !== 'pickup' && (cur.status === 'received' || cur.status === 'preparing')) {
        advanced = true;
      }
    }

    const patch: any = {
      external_tracking_url: url || null,
      external_tracking_provider: provider || null,
    };
    if (advanced) patch.status = 'out-for-delivery';

    const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
    if (error) { setSaving(false); return toast.error('Erro ao salvar: ' + error.message); }

    if (url && lalamoveActive && confirm('Cancelar a corrida na Lalamove agora? Você passará a usar o link externo.')) {
      try {
        const { data, error: cErr } = await unifiedInvoke("delivery-unified", "lalamove-cancel", { orderId });
        if (cErr || (data as { error?: string })?.error) {
          throw new Error((data as { error?: string })?.error || cErr?.message || 'Erro');
        }
        toast.success('Lalamove cancelada. Usando rastreio externo.');
      } catch (e) {
        toast.error('Falha ao cancelar Lalamove: ' + (e instanceof Error ? e.message : String(e)));
      }
    } else if (advanced) {
      toast.success('Link salvo · Pedido marcado como "Saiu para Entrega"');
    } else {
      toast.success(url ? 'Link de rastreio salvo' : 'Link removido');
    }

    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-primary hover:underline mt-1">
        + Colar link de rastreio (Uber Entrega, 99, etc.)
      </button>
    );
  }

  return (
    <div className={`text-xs mt-1 rounded-lg p-2 space-y-1.5 ${highlight ? 'bg-orange-500/10 border-2 border-orange-500/50 animate-pulse' : 'bg-secondary/40 border border-border'}`}>
      <p className="text-foreground font-medium">🔗 Rastreio externo {highlight && <span className="text-orange-400">— cole o link da corrida aqui</span>}</p>
      <input
        type="text"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        placeholder="Nome do serviço (ex: Uber Entrega)"
        className="w-full rounded bg-background border border-border px-2 py-1 text-xs text-foreground"
      />
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://link-do-rastreio..."
        className="w-full rounded bg-background border border-border px-2 py-1 text-xs text-foreground"
      />
      <div className="flex gap-1.5">
        <button onClick={save} disabled={saving} className="flex-1 rounded bg-primary text-primary-foreground py-1 text-xs font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        {initialUrl && (
          <button onClick={() => { setUrl(''); setProvider(''); setTimeout(save, 0); }} className="rounded bg-red-500/20 text-red-400 px-2 py-1 text-xs hover:bg-red-500/30">
            Remover
          </button>
        )}
        <button onClick={() => setOpen(false)} className="rounded bg-secondary text-muted-foreground px-2 py-1 text-xs hover:text-foreground">
          Fechar
        </button>
      </div>
    </div>
  );
};

export default TenantAdminOrders;
