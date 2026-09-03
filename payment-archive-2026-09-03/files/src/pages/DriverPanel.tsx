import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useDriverByToken, setDriverOnline } from '@/hooks/useDrivers';
import { useDriverTracking } from '@/hooks/useDriverTracking';
import { Package, Truck, CheckCircle, MapPin, Clock, AlertTriangle, Navigation, Bell, BellRing, Power, Radar } from 'lucide-react';
import { toast } from 'sonner';
import { registerPushSubscription } from '@/lib/push-notifications';
import { DriverRouteMap } from '@/components/shared/DriverRouteMap';
import HelpButton from '@/components/tenant/HelpButton';
import SofiaChat from '@/components/SofiaChat';
import { useStoreManifest } from '@/hooks/useStoreManifest';
import { parseAddress } from '@/lib/address-utils';

type OrderWithItems = {
  id: string; status: string; total: number; delivery_type: string;
  created_at: string; customer_name: string; customer_phone: string; customer_address: string;
  delivery_status_note: string;
  payment_method?: string;
  change_for?: number;
  order_items: { id: string; product_name: string; product_price: number; quantity: number }[];
};

// Abre o app de mapas externo (Apple Maps no iOS, Google Maps no resto)
const openNavigation = (address: string) => {
  const fullAddress = /brasil|brazil/i.test(address) ? address : `${address}, Brasil`;
  const encoded = encodeURIComponent(fullAddress);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isIOS) {
    window.open(`https://maps.apple.com/?daddr=${encoded}&dirflg=d`, '_blank');
  } else {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encoded}`, '_blank');
  }
};

const DriverPanel = () => {
  const { token } = useParams<{ token: string }>();
  const { data: driver, isLoading } = useDriverByToken(token);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [tenantPix, setTenantPix] = useState<{ key: string; type: string }>({ key: '', type: '' });
  const [customNote, setCustomNote] = useState<Record<string, string>>({});
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [navAddress, setNavAddress] = useState<string | null>(null); // endereço aberto no iframe
  const prevCountRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const slug = window.location.pathname.split('/')[2] || '';
  useStoreManifest({
    slug,
    startPath: `/loja/${slug}/motoboy/${token}`,
    scopePath: `/loja/${slug}/motoboy/`,
  });

  // (Service worker is registered globally in src/main.tsx so it's active
  // before the user opens the Chrome menu — required for the "Install app"
  // PWA prompt to appear instead of just "Add to Home Screen".)

  // Register push notifications + load tenant pix key + sync online state when driver loads
  useEffect(() => {
    if (!driver) return;
    setIsOnline(!!(driver as any).is_online);
    registerPushSubscription(driver.id).then(ok => {
      setPushEnabled(ok);
      if (ok) toast.success('🔔 Notificações push ativadas!');
    });
    (supabase as any).rpc('get_tenant_pix', { _tenant_id: driver.tenant_id }).then(({ data }: any) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setTenantPix({ key: row.pix_key || '', type: row.pix_key_type || '' });
    });
  }, [driver]);

  // Auto-offline ao fechar/recarregar a aba — usa sendBeacon (garante envio
  // mesmo após o JS pausar). O update direto via supabase-js NÃO funciona aqui
  // porque a aba fecha antes do fetch sair. Edge function set-driver-online
  // aceita o payload do beacon.
  useEffect(() => {
    if (!driver || !token || !isOnline) return;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/set-driver-online`;
    const handler = () => {
      try {
        const payload = JSON.stringify({ token, online: false });
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } catch { /* ignore */ }
    };
    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('beforeunload', handler);
    };
  }, [driver, token, isOnline]);

  // Heartbeat: enquanto online, atualiza last_online_at a cada 60s
  // pra que painéis (lojista/fornecedor) continuem mostrando "verde"
  useEffect(() => {
    if (!driver || !isOnline) return;
    const beat = () => {
      supabase.from('drivers')
        .update({ is_online: true, last_online_at: new Date().toISOString() } as any)
        .eq('id', driver.id)
        .then(() => { /* silencioso */ });
    };
    beat(); // imediato
    const i = setInterval(beat, 60_000);
    return () => clearInterval(i);
  }, [driver, isOnline]);

  const toggleOnline = async () => {
    if (!driver) return;
    setTogglingOnline(true);
    const next = !isOnline;
    try {
      await setDriverOnline(driver.id, next, token);
      setIsOnline(next);
      toast.success(next ? '🟢 Você está ONLINE — pronto pra receber entregas' : '⚫ Você está offline');
    } catch {
      toast.error('Erro ao atualizar status');
    } finally {
      setTogglingOnline(false);
    }
  };

  const fetchOrders = useCallback(async () => {
    if (!driver) return;
    const { data } = await supabase
      .from('orders').select('*, order_items(*)')
      .eq('tenant_id', driver.tenant_id)
      .eq('driver_id', driver.id)
      .in('status', ['out-for-delivery', 'delivered'])
      .order('created_at', { ascending: false })
      .limit(50);
    const newOrders = (data as OrderWithItems[]) || [];
    
    // Notify on new active deliveries
    const activeCount = newOrders.filter(o => o.status === 'out-for-delivery').length;
    if (activeCount > prevCountRef.current && prevCountRef.current > 0) {
      try { audioRef.current?.play(); } catch {}
      toast.success('🔔 Nova entrega atribuída!', { duration: 8000 });
    }
    prevCountRef.current = activeCount;
    
    setOrders(newOrders);
  }, [driver]);

  // Real-time subscription for new order assignments
  useEffect(() => {
    if (!driver) return;

    const channel = supabase
      .channel(`driver-orders-${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `driver_id=eq.${driver.id}`,
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [driver, fetchOrders]);

  useEffect(() => {
    if (!driver) return;
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [driver, fetchOrders]);

  const setStatus = async (id: string, status: string, note?: string) => {
    if (status === 'delivered' && !confirm('Confirmar entrega?')) return;
    const noteValue = note || '';
    const kds = (await import('@/hooks/useOrders')).kdsPatchForStatus(status) || {};
    await supabase.from('orders').update({ status, delivery_status_note: noteValue, ...kds }).eq('id', id);
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, delivery_status_note: noteValue } : o));

    // Register a timeline event so the customer sees driver notes in the
    // status page even after subsequent updates overwrite the field.
    if (driver) {
      try {
        const description = status === 'delivered'
          ? `Motoboy ${driver.name} confirmou entrega`
          : noteValue
            ? `Motoboy ${driver.name}: ${noteValue}`
            : `Motoboy ${driver.name} atualizou o pedido`;
        await (supabase as any).from('order_events').insert({
          order_id: id,
          tenant_id: driver.tenant_id,
          event_type: status === 'delivered' ? 'delivered' : 'driver_note',
          to_status: status,
          actor: 'driver',
          actor_id: driver.id,
          description,
          metadata: { note: noteValue, driver_name: driver.name },
        });
      } catch { /* non-blocking */ }
    }

    toast.success(`Status atualizado: ${status === 'delivered' ? 'Entregue' : note || status}`);
  };

  // Active deliveries (calc precoce para tracking GPS)
  const active = orders.filter(o => o.status === 'out-for-delivery');

  // Habilita rastreamento GPS sempre que online — assim cliente/lojista vê
  // posição em tempo real mesmo sem entrega ativa (motoboy circulando, base etc.).
  const tracking = useDriverTracking({
    driverToken: token,
    enabled: !!driver && isOnline,
  });

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!driver) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Motoboy não encontrado.</p></div>;

  const delivered = orders.filter(o => o.status === 'delivered');

  return (
    <div className="min-h-screen bg-background">
      <audio ref={audioRef} src="https://actions.google.com/sounds/v1/alarms/beep_short.ogg" preload="auto" />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            <span className="font-heading text-lg text-foreground">Painel Motoboy</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              {driver.name}
              {pushEnabled && <BellRing className="h-3 w-3 text-green-500" />}
            </span>
            <HelpButton topic="driverPanel" />
          </div>
        </div>
        {/* Online/Offline toggle — controla se o motoboy aparece como disponível pra fallback de entregas */}
        <div className="container mx-auto px-4 pb-3 space-y-2">
          <button
            onClick={toggleOnline}
            disabled={togglingOnline}
            className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all disabled:opacity-50 ${
              isOnline
                ? 'bg-green-500/15 text-green-500 border border-green-500/40 hover:bg-green-500/25'
                : 'bg-muted text-muted-foreground border border-border hover:bg-muted/80'
            }`}
          >
            <Power className={`h-4 w-4 ${isOnline ? 'animate-pulse' : ''}`} />
            {togglingOnline ? 'Atualizando...' : isOnline ? '🟢 Online — recebendo entregas' : '⚫ Offline — toque pra ficar disponível'}
          </button>
          {isOnline && (
            <div className={`flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs ${
              tracking.permission === 'denied'
                ? 'bg-destructive/15 text-destructive border border-destructive/40'
                : tracking.lastUpdate
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                  : 'bg-muted text-muted-foreground border border-border'
            }`}>
              <Radar className={`h-3.5 w-3.5 ${tracking.lastUpdate ? 'animate-pulse' : ''}`} />
              {tracking.permission === 'denied'
                ? 'Permissão GPS negada — cliente não verá sua posição'
                : tracking.lastUpdate
                  ? `Compartilhando localização · atualizado ${new Date(tracking.lastUpdate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                  : 'Aguardando GPS...'}
            </div>
          )}
        </div>
      </header>

      <div className="container mx-auto px-4 py-4 space-y-6">
        <div>
          <h2 className="font-heading text-foreground mb-3 flex items-center gap-2">
            🏍️ Entregas Ativas
            {active.length > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold w-5 h-5">
                {active.length}
              </span>
            )}
          </h2>
          {active.length === 0 && <p className="text-center text-muted-foreground py-4">Nenhuma entrega pendente.</p>}
          {active.map(order => (
            <div key={order.id} className="rounded-lg border border-primary/30 bg-card p-4 space-y-3 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground text-sm">#{order.id.slice(0, 6)}</span>
                  <span className="flex items-center gap-1 text-xs text-primary animate-pulse">
                    <Bell className="h-3 w-3" />
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString('pt-BR')}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                <p><strong className="text-foreground">{order.customer_name}</strong> · {order.customer_phone}</p>
                {(() => {
                  const { main, reference } = parseAddress(order.customer_address);
                  return (
                    <>
                      <p className="flex items-start gap-1 mt-1"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span>{main}</span></p>
                      {reference && (
                        <div className="mt-1 rounded-md border-2 border-amber-500/60 bg-amber-500/15 p-2">
                          <p className="text-xs font-bold text-amber-400">📍 PONTO DE REFERÊNCIA</p>
                          <p className="text-sm text-amber-300 font-medium">{reference}</p>
                        </div>
                      )}
                    </>
                  );
                })()}
                {order.payment_method && (() => {
                  const pm = (order.payment_method || '').toLowerCase();
                  // Considera "pago online" qualquer método que rode pela maquininha digital
                  // (Mercado Pago, Pix online, cartão online). "Na entrega" = Dinheiro,
                  // "Cartão na entrega", "Pix na entrega", "Maquininha".
                  const paidOnline = /mercado\s*pago|online|pix\s*online|cart[aã]o\s*online|pago/i.test(order.payment_method);
                  const cashOnDelivery = /dinheiro|cash/i.test(pm);
                  const isOnDelivery = !paidOnline; // default: receber na entrega
                  return (
                    <div className="mt-2 space-y-1">
                      <p>💳 <strong className="text-foreground">{order.payment_method}</strong> · Total <strong className="text-foreground">R${order.total.toFixed(2)}</strong></p>
                      {isOnDelivery ? (
                        <div className="rounded-md border border-orange-500/40 bg-orange-500/10 p-2">
                          <p className="text-xs text-orange-400 font-bold">
                            ⚠️ RECEBER NA ENTREGA — R${order.total.toFixed(2)}
                          </p>
                          <p className="text-[11px] text-orange-300/80">
                            {cashOnDelivery
                              ? 'Cliente vai pagar em dinheiro.'
                              : /pix/i.test(pm)
                                ? 'Cliente vai pagar via Pix na hora — confirme antes de entregar.'
                                : /cart[aã]o|maquin/i.test(pm)
                                  ? 'Cliente vai pagar no cartão — leve a maquininha.'
                                  : 'Confirme o pagamento antes de entregar.'}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2">
                          <p className="text-xs text-green-400 font-bold">
                            ✅ JÁ PAGO ONLINE — não cobrar nada
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {order.change_for && order.change_for > 0 && /dinheiro|cash/i.test(order.payment_method || '') && (
                  <div className="mt-1 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2">
                    <p className="text-xs text-yellow-400 font-bold">💵 Troco: cliente vai pagar com R${order.change_for.toFixed(2)}</p>
                    <p className="text-xs text-yellow-400">Levar <strong>R${(order.change_for - order.total).toFixed(2)}</strong> de troco</p>
                  </div>
                )}
                {/^pix$/i.test((order.payment_method || '').trim()) && tenantPix.key && (
                  <div className="mt-1 rounded-md border border-primary/40 bg-primary/10 p-2 space-y-1">
                    <p className="text-xs text-primary font-bold">📲 Pix da loja {tenantPix.type ? `(${tenantPix.type})` : ''}:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono text-foreground break-all">{tenantPix.key}</code>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(tenantPix.key); toast.success('Chave copiada'); }}
                        className="rounded-md bg-primary/20 text-primary px-2 py-0.5 text-[10px] font-medium hover:bg-primary/30">Copiar</button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Confirme com o cliente se o Pix já foi feito.</p>
                  </div>
                )}
              </div>

              {/* Navigation button - abre mapa embutido (90% tela) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setNavAddress(order.customer_address)}
                  className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 text-white py-3 text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  <Navigation className="h-5 w-5" />
                  Mapa aqui dentro
                </button>
                <button
                  onClick={() => openNavigation(order.customer_address)}
                  className="flex items-center justify-center gap-2 rounded-lg bg-secondary text-foreground py-3 text-sm font-medium hover:bg-secondary/80 transition-colors border border-border"
                >
                  <MapPin className="h-5 w-5" />
                  Abrir no app GPS
                </button>
              </div>

              <div className="text-sm space-y-1">
                {order.order_items.map(i => (
                  <div key={i.id} className="flex justify-between text-muted-foreground">
                    <span>{i.quantity}x {i.product_name}</span>
                  </div>
                ))}
              </div>
              {order.delivery_status_note && (
                <p className="text-xs text-yellow-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {order.delivery_status_note}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setStatus(order.id, 'delivered')} className="rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90">
                  <CheckCircle className="h-4 w-4 inline mr-1" /> Entregue
                </button>
                <button onClick={() => setStatus(order.id, 'out-for-delivery', 'Vou atrasar')} className="rounded-lg bg-yellow-500/20 text-yellow-400 py-2 text-sm font-medium hover:bg-yellow-500/30">
                  <Clock className="h-4 w-4 inline mr-1" /> Atrasar
                </button>
              </div>
              <div className="flex gap-2">
                <input value={customNote[order.id] || ''} onChange={e => setCustomNote(prev => ({ ...prev, [order.id]: e.target.value }))}
                  placeholder="Nota personalizada (ex: acidente)" className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
                <button onClick={() => { if (customNote[order.id]) setStatus(order.id, 'out-for-delivery', customNote[order.id]); }}
                  className="rounded-lg bg-secondary text-foreground px-3 py-2 text-sm hover:bg-secondary/80">Enviar</button>
              </div>
            </div>
          ))}
        </div>

        {delivered.length > 0 && (
          <div>
            <h2 className="font-heading text-foreground mb-3">✅ Entregues</h2>
            {delivered.map(o => (
              <div key={o.id} className="rounded-lg border border-border bg-card p-3 text-sm mb-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-foreground font-medium">#{o.id.slice(0, 6)} · {o.customer_name}</span>
                  <span className="text-green-400 text-xs">Entregue</span>
                </div>
                <p className="text-xs text-muted-foreground">{o.customer_phone}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {o.customer_address}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mapa Leaflet com rota desenhada (90% da tela) — motoboy não sai do app */}
      {navAddress && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-card shrink-0" style={{ height: '10vh' }}>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Navegação</p>
              <p className="text-sm font-medium text-foreground truncate flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-primary shrink-0" /> {navAddress}
              </p>
            </div>
            <button
              onClick={() => openNavigation(navAddress)}
              className="rounded-lg bg-blue-600 text-white px-3 py-2 text-xs font-medium hover:bg-blue-700 shrink-0"
            >
              Abrir no app
            </button>
            <button
              onClick={() => setNavAddress(null)}
              className="rounded-lg bg-secondary text-foreground border border-border px-3 py-2 text-xs font-medium hover:bg-secondary/80 shrink-0"
            >
              ✕ Fechar
            </button>
          </div>
          <div style={{ height: '90vh' }} className="w-full">
            <DriverRouteMap
              destinationAddress={navAddress}
              driverPosition={tracking.lastPosition ?? null}
            />
          </div>
        </div>
      )}

      {/* Sofia — papel travado: motoboy. Backend sabe se tá online e quantas entregas tem. */}
      <SofiaChat
        role="driver"
        driverId={driver.id}
        greeting={`Oi ${driver.name}! Sou a **Sofia** ✨ Tô aqui no seu painel de motoboy. Pergunta como ficar online, receber entrega, marcar entregue ou lidar com pagamento.`}
      />
    </div>
  );
};

export default DriverPanel;
