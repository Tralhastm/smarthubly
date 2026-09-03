import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenantBySlug } from '@/hooks/useTenants';
import { useDriverLocation } from '@/hooks/useDriverLocation';
import { downloadIcs } from '@/lib/ics';
import { Package, Clock, ChefHat, Truck, CheckCircle, CreditCard, XCircle, ArrowLeft, Store, MapPin, Phone, MessageCircle, CheckCircle2, Radar, CalendarPlus, PartyPopper } from 'lucide-react';
import OrderTimeline from '@/components/tenant/OrderTimeline';
import CustomerOrderChat from '@/components/tenant/CustomerOrderChat';
import OrderReviewForm from '@/components/tenant/OrderReviewForm';
import ExternalTrackingEmbed from '@/components/tenant/ExternalTrackingEmbed';
import DriverMap, { type MapMarker } from '@/components/shared/DriverMap';
import { useRouteEta, formatEta, formatDistance } from '@/hooks/useRouteEta';
import { useToast } from '@/hooks/use-toast';
import { deriveBrandTokens, applyBrandTokens, clearBrandTokens } from '@/lib/color-utils';

const statusConfig: Record<string, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  pending_payment: { label: 'Aguardando Pagamento', icon: <CreditCard className="h-5 w-5" />, color: 'bg-purple-500/20 text-purple-400', description: 'Conclua o pagamento para que possamos preparar seu pedido.' },
  pending_review: { label: 'Em Análise', icon: <Clock className="h-5 w-5" />, color: 'bg-amber-500/20 text-amber-400', description: 'Sua loja está revisando o pedido. Logo entra em preparo.' },
  received: { label: 'Recebido', icon: <Clock className="h-5 w-5" />, color: 'bg-blue-500/20 text-blue-400', description: 'Seu pedido foi recebido e logo será preparado.' },
  preparing: { label: 'Em Preparo', icon: <ChefHat className="h-5 w-5" />, color: 'bg-yellow-500/20 text-yellow-400', description: 'Seu pedido está sendo preparado com carinho.' },
  'out-for-delivery': { label: 'Saiu para Entrega', icon: <Truck className="h-5 w-5" />, color: 'bg-orange-500/20 text-orange-400', description: 'O motoboy está a caminho!' },
  'ready-for-pickup': { label: 'Pronto para Retirada', icon: <Store className="h-5 w-5" />, color: 'bg-cyan-500/20 text-cyan-400', description: 'Seu pedido está pronto! Pode vir buscar na loja.' },
  delivered: { label: 'Entregue', icon: <CheckCircle className="h-5 w-5" />, color: 'bg-green-500/20 text-green-400', description: 'Pedido finalizado.' },
  cancelled: { label: 'Cancelado', icon: <XCircle className="h-5 w-5" />, color: 'bg-red-500/20 text-red-400', description: 'Esse pedido foi cancelado.' },
};

const STEPS_DELIVERY = ['received', 'preparing', 'out-for-delivery', 'delivered'];
const STEPS_PICKUP = ['received', 'preparing', 'ready-for-pickup', 'delivered'];

type OrderRow = {
  id: string; status: string; total: number; delivery_type: string; payment_method: string;
  created_at: string; customer_name: string; customer_phone: string; customer_address: string;
  delivery_status_note: string | null; delivery_fee: number; tenant_id: string; supplier_id: string | null;
  driver_id: string | null;
  change_for?: number | null;
  lalamove_order_id?: string | null; lalamove_status?: string | null; lalamove_share_link?: string | null;
  lalamove_driver_name?: string | null; lalamove_driver_phone?: string | null; lalamove_driver_plate?: string | null;
  external_tracking_url?: string | null; external_tracking_provider?: string | null;
  order_items: {
    id: string; product_name: string; product_price: number; quantity: number;
    variant_name?: string | null; addons?: { name: string; price: number; quantity: number }[] | null; notes?: string | null;
  }[];
};

type AppointmentRow = {
  id: string; product_name: string; scheduled_start: string; planned_duration_minutes: number; delay_minutes: number;
};

type DriverInfo = { name: string; phone: string } | null;

const TenantOrderStatus = () => {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { data: tenant, isLoading: tenantLoading } = useTenantBySlug(slug);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [driverInfo, setDriverInfo] = useState<DriverInfo>(null);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [paymentApprovedBanner, setPaymentApprovedBanner] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!id) return;
    const fetchOrder = async () => {
      const { data: ord } = await (supabase as any).from('orders_public').select('*').eq('id', id).maybeSingle();
      if (!ord) { setOrderLoaded(true); return; }
      const { data: items } = await (supabase as any).rpc('get_order_items_public', { _order_id: id });
      const newOrder = { ...ord, order_items: items || [] } as unknown as OrderRow;

      // 🎉 Detecta transição de pending_payment → received/preparing (pagamento aprovado)
      const prev = prevStatusRef.current;
      if (prev === 'pending_payment' && ['received', 'preparing'].includes(newOrder.status)) {
        toast({
          title: '✅ Pagamento aprovado!',
          description: 'Seu pedido foi confirmado e já está com a loja.',
        });
        setPaymentApprovedBanner(true);
        try { (navigator as any).vibrate?.([200, 100, 200]); } catch {}
      }
      prevStatusRef.current = newOrder.status;

      setOrder(newOrder);
      setOrderLoaded(true);
    };
    fetchOrder();
    const interval = setInterval(fetchOrder, 4000);
    return () => clearInterval(interval);
  }, [id, toast]);

  // Banner persistente quando o cliente vem do gateway com ?paid=1
  useEffect(() => {
    if (searchParams.get('paid') === '1') {
      setPaymentApprovedBanner(true);
      const next = new URLSearchParams(searchParams);
      next.delete('paid');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Carrega agendamentos vinculados ao pedido (view pública sem PII)
  useEffect(() => {
    if (!id) return;
    (supabase as any).from('appointments_public')
      .select('id, product_name, scheduled_start, planned_duration_minutes, delay_minutes')
      .eq('order_id', id).order('scheduled_start')
      .then(({ data }: { data: AppointmentRow[] | null }) => { if (data) setAppointments(data); });
  }, [id]);

  // Buscar info do motoboy próprio quando atribuído (view pública sem token)
  useEffect(() => {
    if (!order?.driver_id) { setDriverInfo(null); return; }
    (supabase as any).from('drivers_public').select('name').eq('id', order.driver_id).maybeSingle()
      .then(({ data }: { data: { name: string } | null }) => { if (data) setDriverInfo({ name: data.name, phone: '' } as DriverInfo); });
  }, [order?.driver_id]);

  // Localização em tempo real do motoboy próprio (só quando saiu para entrega)
  const driverLocation = useDriverLocation(order?.status === 'out-for-delivery' ? order?.driver_id : null);

  // Rota + ETA do motoboy até o endereço do cliente
  const routeEta = useRouteEta({
    originLat: driverLocation ? Number(driverLocation.lat) : null,
    originLng: driverLocation ? Number(driverLocation.lng) : null,
    destAddress: order?.customer_address || null,
    enabled: !!driverLocation && order?.status === 'out-for-delivery',
  });


  if (tenantLoading || !orderLoaded) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }
  if (!order || !tenant) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Pedido não encontrado.</p></div>;
  }

  const cfg = statusConfig[order.status] || statusConfig.received;
  const STEPS = order.delivery_type === 'pickup' ? STEPS_PICKUP : STEPS_DELIVERY;
  const currentStepIdx = STEPS.indexOf(order.status);
  const isFinalized = order.status === 'delivered' || order.status === 'cancelled';

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
              <span className="text-xs text-muted-foreground">Acompanhar Pedido</span>
            </div>
          </div>
          <Link to={`/loja/${slug}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> Loja
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        {/* 🎉 Banner de pagamento aprovado — fica até o cliente fechar */}
        {paymentApprovedBanner && order.status !== 'pending_payment' && order.status !== 'cancelled' && (
          <div className="rounded-2xl border border-green-500/40 bg-gradient-to-br from-green-500/15 to-emerald-500/10 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <div className="shrink-0 w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <PartyPopper className="h-5 w-5 text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-green-400">Pagamento aprovado!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Recebemos sua confirmação do Mercado Pago. A loja já foi avisada e seu pedido está sendo preparado.
              </p>
            </div>
            <button
              onClick={() => setPaymentApprovedBanner(false)}
              className="shrink-0 text-muted-foreground hover:text-foreground p-1"
              aria-label="Fechar"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Hero status */}
        <div className="rounded-2xl border border-border bg-card p-5 text-center space-y-3">
          <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 ${cfg.color}`}>
            {cfg.icon}
            <span className="font-bold">{cfg.label}</span>
          </div>
          <p className="text-muted-foreground text-sm">{cfg.description}</p>
          {order.status === 'pending_payment' && (
            <Link
              to={`/loja/${slug}/pagar/${order.id}`}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90"
            >
              <CreditCard className="h-4 w-4" /> Realizar pagamento agora
            </Link>
          )}
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 mt-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Código do pedido</p>
            <p className="text-2xl font-mono font-bold text-primary tracking-widest mt-0.5">#{order.id.slice(0, 8).toUpperCase()}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(order.id.slice(0, 8).toUpperCase()); }}
              className="mt-1 text-[11px] text-primary underline"
            >📋 Copiar e salvar</button>
            <p className="text-[10px] text-muted-foreground mt-1">Guarde este código para consultar o status depois.</p>
          </div>
          <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString('pt-BR')}</p>
          {order.delivery_status_note && (
            <p className="text-xs text-yellow-400 mt-2">⚠️ {order.delivery_status_note}</p>
          )}
        </div>

        {/* Progress bar (only delivery flow) */}
        {!isFinalized && order.status !== 'pending_payment' && order.status !== 'pending_review' && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-1">
              {STEPS.map((s, idx) => {
                const active = idx <= currentStepIdx;
                const isCurrent = idx === currentStepIdx;
                return (
                  <div key={s} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className={`h-2 w-full rounded-full transition-all ${active ? 'gradient-primary' : 'bg-secondary'} ${isCurrent ? 'animate-pulse' : ''}`} />
                    <span className={`text-[10px] text-center ${active ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {statusConfig[s]?.label.split(' ')[0]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Order details */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="font-bold text-foreground flex items-center gap-2"><Package className="h-4 w-4 text-primary" /> Itens</h3>
          {order.order_items.map(i => (
            <div key={i.id} className="text-sm space-y-0.5">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-1">{i.quantity}x {i.product_name}</span>
                <span className="text-foreground shrink-0">R${(i.product_price * i.quantity).toFixed(2)}</span>
              </div>
              {i.variant_name && (
                <p className="text-[11px] text-muted-foreground pl-3">Opção: {i.variant_name}</p>
              )}
              {i.addons && Array.isArray(i.addons) && i.addons.length > 0 && (
                <p className="text-[11px] text-muted-foreground pl-3">
                  + {i.addons.map(a => `${a.quantity}x ${a.name}`).join(', ')}
                </p>
              )}
              {i.notes && (
                <p className="text-[11px] text-muted-foreground italic pl-3">📝 {i.notes}</p>
              )}
            </div>
          ))}
          {order.delivery_fee > 0 && (
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="text-muted-foreground">Taxa de entrega</span>
              <span className="text-foreground">R${order.delivery_fee.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold border-t border-border pt-2">
            <span className="text-foreground">Total</span>
            <span className="text-primary">R${order.total.toFixed(2)}</span>
          </div>
        </div>

        {/* Agendamentos do pedido — botão pra baixar lembrete .ics */}
        {appointments.length > 0 && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <CalendarPlus className="h-4 w-4 text-primary" /> Seus agendamentos
            </h3>
            {appointments.map(a => {
              const start = new Date(a.scheduled_start);
              const totalMin = (a.planned_duration_minutes || 30) + (a.delay_minutes || 0);
              const end = new Date(start.getTime() + totalMin * 60000);
              return (
                <div key={a.id} className="rounded-lg bg-card border border-border p-3 space-y-1">
                  <p className="text-sm font-medium text-foreground">{a.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    📅 {start.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {' → '}{end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <button
                    onClick={() => downloadIcs({
                      title: `${a.product_name} — ${tenant.name}`,
                      description: `Pedido #${order.id.slice(0, 8)}`,
                      location: tenant.address || '',
                      start, end,
                      uid: `${a.id}@${tenant.id}`,
                    }, `agendamento-${a.id.slice(0, 6)}.ics`)}
                    className="w-full mt-1 flex items-center justify-center gap-2 rounded-md bg-primary/10 text-primary py-2 text-xs font-medium hover:bg-primary/20"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" /> Adicionar à minha agenda
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagamento (forma + onde será pago) — sempre visível pro cliente */}
        {order.payment_method && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
            <h3 className="font-bold text-foreground flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /> Pagamento</h3>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Forma:</span>
              <span className="text-foreground font-medium">{order.payment_method}</span>
            </div>
            {/* "Pagar na entrega/balcão" = método Dinheiro/Pix sem MercadoPago. Mostra etiqueta clara. */}
            {!/mercadopago/i.test(order.payment_method) && (
              <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-2.5 text-xs">
                {order.delivery_type === 'pickup' ? (
                  <p className="text-yellow-700 dark:text-yellow-400">
                    💵 <strong>Pagar no balcão na hora da retirada</strong> — leve o valor exato ou avise se precisa de troco.
                  </p>
                ) : (
                  <p className="text-yellow-700 dark:text-yellow-400">
                    💵 <strong>Pagar na entrega</strong> — combine com o motoboy. Se for Pix, ele te passa a chave da loja na hora pra evitar fraude.
                  </p>
                )}
              </div>
            )}
            {order.change_for && order.change_for > 0 && /dinheiro/i.test(order.payment_method) && (
              <p className="text-xs text-muted-foreground">Troco para R${order.change_for.toFixed(2)}</p>
            )}
          </div>
        )}

        {/* Delivery info */}
        {order.delivery_type === 'delivery' && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-primary mt-0.5" />
              <div>
                <p className="text-foreground font-medium">Endereço</p>
                <p className="text-muted-foreground">{order.customer_address}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">{order.customer_phone}</span>
            </div>
          </div>
        )}

        {/* Tracking entrega — Lalamove ou motoboy próprio */}
        {order.status === 'out-for-delivery' && order.delivery_type === 'delivery' && !order.external_tracking_url && (
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-2">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Truck className="h-4 w-4 text-orange-400" /> Acompanhar entrega
            </h3>
            {(order.lalamove_order_id || order.lalamove_share_link || order.lalamove_status) && order.lalamove_status !== 'CANCELED' ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Sua entrega está sendo feita pela <strong className="text-foreground">Lalamove</strong>.
                  {order.lalamove_status && <span className="ml-1 px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 text-[10px] font-medium">{order.lalamove_status}</span>}
                </p>
                {order.lalamove_driver_name && (
                  <div className="rounded-md bg-card p-2 border border-border text-xs space-y-0.5">
                    <p className="text-foreground font-medium">🏍️ {order.lalamove_driver_name}</p>
                    {order.lalamove_driver_phone && (
                      <p className="text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {order.lalamove_driver_phone}
                        {order.lalamove_driver_plate && <span className="ml-2">· Placa {order.lalamove_driver_plate}</span>}
                      </p>
                    )}
                  </div>
                )}
                {order.lalamove_share_link && (
                  <a href={order.lalamove_share_link} target="_blank" rel="noreferrer"
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-orange-500/20 text-orange-400 py-2.5 text-sm font-medium hover:bg-orange-500/30 transition">
                    <MapPin className="h-4 w-4" /> Ver no mapa em tempo real
                  </a>
                )}
              </>
            ) : driverInfo ? (
              <>
                <p className="text-xs text-muted-foreground">Seu motoboy está a caminho:</p>
                <div className="rounded-md bg-card p-2 border border-border text-xs space-y-0.5">
                  <p className="text-foreground font-medium">🏍️ {driverInfo.name}</p>
                  {driverInfo.phone && (
                    <p className="text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {driverInfo.phone}
                    </p>
                  )}
                </div>

                {/* Mapa em tempo real — aparece quando o motoboy compartilhou GPS */}
                {driverLocation ? (
                  <div className="space-y-1">
                    {(() => {
                      const markers: MapMarker[] = [
                        { type: 'driver', lat: Number(driverLocation.lat), lng: Number(driverLocation.lng), label: `🏍️ ${driverInfo.name}` },
                      ];
                      if (routeEta.destLat != null && routeEta.destLng != null) {
                        markers.push({ type: 'customer', lat: routeEta.destLat, lng: routeEta.destLng, label: '📍 Entrega aqui' });
                      }
                      return <DriverMap markers={markers} route={routeEta.polyline || undefined} height="240px" />;
                    })()}
                    {/* ETA + distância */}
                    {routeEta.durationS != null && (
                      <div className="flex items-center justify-between rounded-md bg-card border border-border px-3 py-2">
                        <div className="flex items-center gap-2 text-xs">
                          <Clock className="h-3.5 w-3.5 text-blue-400" />
                          <span className="text-foreground font-medium">{formatEta(routeEta.durationS)}</span>
                          <span className="text-muted-foreground">· {formatDistance(routeEta.distanceM)}</span>
                        </div>
                        {routeEta.loading && <span className="text-[10px] text-muted-foreground">recalculando...</span>}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Radar className="h-3 w-3 animate-pulse text-blue-400" />
                      Posição atualizada {new Date(driverLocation.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">Aguardando o motoboy compartilhar a localização...</p>
                )}

                {driverInfo.phone && (
                  <a href={`https://wa.me/${driverInfo.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Sobre o pedido #${order.id.slice(0,8)}`)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-600 text-white py-2.5 text-sm font-medium hover:bg-green-700 transition">
                    <MessageCircle className="h-4 w-4" /> Falar com o motoboy
                  </a>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Pedido saiu para entrega — em instantes você verá detalhes do motoboy.</p>
            )}
          </div>
        )}

        {/* Rastreio externo (Uber Entrega, 99, etc.) — link colado pelo lojista */}
        {order.external_tracking_url && order.status !== 'cancelled' && order.status !== 'delivered' && (
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-2">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Truck className="h-4 w-4 text-orange-400" /> Acompanhar entrega
            </h3>
            <ExternalTrackingEmbed url={order.external_tracking_url} provider={order.external_tracking_provider} />
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-bold text-foreground mb-3">Linha do tempo</h3>
          <OrderTimeline orderId={order.id} />
        </div>

        {/* Chat com a loja sobre este pedido */}
        {order.status !== 'cancelled' && (
          <CustomerOrderChat
            order={{ id: order.id, tenant_id: order.tenant_id, customer_name: order.customer_name, customer_phone: order.customer_phone }}
            tenantName={tenant.name}
          />
        )}

        {/* WhatsApp fallback */}
        {tenant.whatsapp && (
          <a
            href={`https://wa.me/${tenant.whatsapp}?text=${encodeURIComponent(`Olá! Sobre o pedido #${order.id.slice(0,8)}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 text-white py-3 font-medium hover:bg-green-700 transition"
          >
            <MessageCircle className="h-5 w-5" /> Falar com a loja no WhatsApp
          </a>
        )}

        {order.status === 'delivered' && (
          <>
            <OrderReviewForm orderId={order.id} tenantId={order.tenant_id} supplierId={order.supplier_id} />
            <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-4 text-center text-green-400 flex items-center justify-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> Pedido finalizado. Volte sempre!
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TenantOrderStatus;
