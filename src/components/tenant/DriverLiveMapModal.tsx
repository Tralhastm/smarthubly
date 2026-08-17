// Modal em tela cheia que mostra UM motoboy específico em tempo real:
// - Posição atual (atualiza via realtime)
// - Rota desenhada até o cliente da entrega ativa (se houver)
// - Loja como ponto de origem (se tenant tiver endereço)
// Pensado pra segurança: lojista consegue acompanhar onde o motoboy está e se está na rota correta.
import { useEffect, useMemo, useState } from 'react';
import { X, Maximize2, Bike, MapPin, Phone, Navigation2, AlertCircle } from 'lucide-react';
import { useDriverLocation } from '@/hooks/useDriverLocation';
import { useOrders } from '@/hooks/useOrders';
import { DriverRouteMap } from '@/components/shared/DriverRouteMap';

interface Props {
  driverId: string;
  driverName: string;
  driverPhone?: string;
  tenantId: string;
  onClose: () => void;
}

const DriverLiveMapModal = ({ driverId, driverName, driverPhone, tenantId, onClose }: Props) => {
  const location = useDriverLocation(driverId);
  const { data: orders = [] } = useOrders(tenantId);

  // Pega entrega ATIVA desse motoboy (se houver). Se tiver, vamos desenhar
  // a rota até o cliente. Se não, só mostra a posição.
  const activeOrder = useMemo(() => {
    return (orders as any[]).find(
      (o) => o.driver_id === driverId && o.status === 'out-for-delivery' && o.customer_address,
    );
  }, [orders, driverId]);

  // Bloqueia scroll do body enquanto modal está aberto
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc fecha o modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ageMin = location ? Math.floor((Date.now() - new Date(location.updated_at).getTime()) / 60_000) : null;
  const isFresh = ageMin !== null && ageMin < 2;

  const driverPosition = location ? { lat: Number(location.lat), lng: Number(location.lng) } : null;

  return (
    <div className="fixed inset-0 z-[1000] bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background/95 backdrop-blur-md px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-full bg-primary/15 p-2 shrink-0">
            <Bike className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-heading text-foreground truncate">{driverName}</p>
            <div className="flex items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1 ${isFresh ? 'text-green-500' : 'text-yellow-500'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isFresh ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                {ageMin === null ? 'Sem GPS' : ageMin < 1 ? 'Ao vivo' : `${ageMin} min atrás`}
              </span>
              {driverPhone && (
                <a href={`tel:${driverPhone}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                  <Phone className="h-3 w-3" /> {driverPhone}
                </a>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar mapa"
          className="rounded-lg bg-secondary text-foreground p-2 hover:bg-secondary/80 shrink-0"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Mapa em tela cheia */}
      <div className="relative flex-1 min-h-0">
        {!location ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm text-center space-y-3">
              <AlertCircle className="h-10 w-10 text-yellow-500 mx-auto" />
              <p className="font-heading text-foreground">Sem sinal de GPS</p>
              <p className="text-sm text-muted-foreground">
                Esse motoboy ainda não compartilhou localização. Peça pra ele abrir
                o painel do motoboy e ativar o status "Online".
              </p>
            </div>
          </div>
        ) : activeOrder ? (
          // Tem entrega ativa → desenha rota até o cliente
          <DriverRouteMap
            destinationAddress={activeOrder.customer_address}
            driverPosition={driverPosition}
          />
        ) : (
          // Sem entrega — só mostra posição via DriverRouteMap usando o próprio
          // ponto como destino (mostra só o marker do motoboy, sem rota).
          // Truque: passamos um "endereço" inválido pra evitar geocode e exibimos
          // mensagem de status. Pra simplicidade, renderizamos um mapa básico.
          <SoloDriverMap position={driverPosition!} driverName={driverName} />
        )}

        {/* Card de info da entrega no rodapé (quando há entrega ativa) */}
        {activeOrder && (
          <div className="absolute bottom-3 left-3 right-3 z-[400] rounded-xl border border-border bg-card/95 backdrop-blur-md p-3 shadow-lg space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-primary font-medium">
              <Navigation2 className="h-3.5 w-3.5" />
              Em entrega · #{activeOrder.id.slice(0, 6)}
            </div>
            <p className="text-sm text-foreground font-medium truncate">{activeOrder.customer_name}</p>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{activeOrder.customer_address}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// Mapa simples só com a posição do motoboy (quando não tem entrega ativa)
const SoloDriverMap = ({ position, driverName }: { position: { lat: number; lng: number }; driverName: string }) => {
  // Usa o DriverMap genérico via render dinâmico pra evitar re-import circular
  // — implementação enxuta com Leaflet imperativo.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!container) return;
    let map: any;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled) return;
      map = L.map(container, { zoomControl: true, attributionControl: false }).setView([position.lat, position.lng], 16);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20, subdomains: 'abcd',
      }).addTo(map);
      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:36px;height:36px;">
          <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.3);animation:soloPulse 1.8s infinite;"></div>
          <div style="position:absolute;inset:6px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:14px;">🏍️</div>
        </div>
        <style>@keyframes soloPulse{0%{transform:scale(0.8);opacity:1}100%{transform:scale(2.2);opacity:0}}</style>`,
        iconSize: [36, 36], iconAnchor: [18, 18],
      });
      L.marker([position.lat, position.lng], { icon }).addTo(map).bindTooltip(driverName, { permanent: true, direction: 'top', offset: [0, -20] });
      setTimeout(() => map.invalidateSize(), 100);
    })();
    return () => { cancelled = true; if (map) map.remove(); };
  }, [container, position.lat, position.lng, driverName]);
  return (
    <>
      <div ref={setContainer} className="w-full h-full" style={{ background: '#ffffff' }} />
      <div className="absolute top-3 left-3 right-3 z-[400] rounded-lg bg-card/95 backdrop-blur-md border border-border px-3 py-2 text-xs text-muted-foreground text-center shadow-lg">
        Sem entrega ativa — mostrando posição em tempo real
      </div>
    </>
  );
};

export default DriverLiveMapModal;
export { Maximize2 };
