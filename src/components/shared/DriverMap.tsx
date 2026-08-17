// Mapa Leaflet com marcadores e rota opcional. Usa OpenStreetMap (grátis, sem API key).
// Renderiza posição do motoboy + opcionalmente loja, cliente e linha de rota.
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix dos ícones padrão do leaflet (URLs quebram com bundler)
const driverIcon = L.divIcon({
  html: `<div style="background:hsl(217 91% 60%);width:32px;height:32px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:18px;">🏍️</div>`,
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const storeIcon = L.divIcon({
  html: `<div style="background:hsl(142 71% 45%);width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:14px;">🏪</div>`,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const customerIcon = L.divIcon({
  html: `<div style="background:hsl(0 84% 60%);width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:14px;">📍</div>`,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export interface MapMarker {
  type: 'driver' | 'store' | 'customer';
  lat: number;
  lng: number;
  label?: string;
}

interface Props {
  markers: MapMarker[];
  /** Polyline opcional da rota — array de [lat,lng] */
  route?: [number, number][];
  height?: string;
  /** Quando true, recentraliza o mapa para enquadrar todos os marcadores em cada update */
  autoFit?: boolean;
}

const FitBounds = ({ markers, route }: { markers: MapMarker[]; route?: [number, number][] }) => {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      ...markers.map(m => [m.lat, m.lng] as [number, number]),
      ...(route || []),
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    const bounds = L.latLngBounds(points);
    // maxZoom menor garante margem visual quando os pontos estão muito próximos,
    // evitando que vários motoboys colem uns nos outros.
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }, [markers, route, map]);
  return null;
};

// Direções alternadas pra tooltips quando há vários marcadores próximos —
// evita sobreposição dos nomes (ex: 2 motoboys no mesmo CEP).
const TOOLTIP_DIRECTIONS = ['top', 'bottom', 'right', 'left'] as const;
const TOOLTIP_OFFSETS: Record<string, [number, number]> = {
  top: [0, -18],
  bottom: [0, 18],
  right: [18, 0],
  left: [-18, 0],
};

const DriverMap = ({ markers, route, height = '320px', autoFit = true }: Props) => {
  const center: [number, number] = markers.length > 0
    ? [markers[0].lat, markers[0].lng]
    : [-23.55, -46.63]; // SP fallback

  // Pra cada marcador, decide direção do tooltip baseado em proximidade com
  // os anteriores. Se há outro marcador muito perto, escolhe direção alternada.
  const tooltipDirs = markers.map((m, i) => {
    if (i === 0) return 'top' as const;
    const tooClose = markers.slice(0, i).some(other => {
      const dLat = Math.abs(other.lat - m.lat);
      const dLng = Math.abs(other.lng - m.lng);
      return dLat < 0.002 && dLng < 0.002; // ~200m
    });
    if (!tooClose) return 'top' as const;
    return TOOLTIP_DIRECTIONS[i % TOOLTIP_DIRECTIONS.length];
  });

  return (
    <div style={{ height, width: '100%' }} className="rounded-lg overflow-hidden border border-border">
      <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%', background: '#ffffff' }} scrollWheelZoom={false}>
        {/* Base CLARA sem rótulos — fundo branco */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
          url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        {/* Rótulos escuros, alto contraste — letras BEM destacadas no fundo branco */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        {route && route.length > 1 && (
          <Polyline
            positions={route}
            pathOptions={{ color: 'hsl(217, 91%, 50%)', weight: 6, opacity: 0.95 }}
          />
        )}
        {markers.map((m, i) => {
          const icon = m.type === 'driver' ? driverIcon : m.type === 'store' ? storeIcon : customerIcon;
          const dir = tooltipDirs[i];
          return (
            <Marker key={`${m.type}-${i}`} position={[m.lat, m.lng]} icon={icon}>
              {m.label && (
                <>
                  <Tooltip
                    permanent
                    direction={dir}
                    offset={TOOLTIP_OFFSETS[dir]}
                    className="!bg-white !text-slate-900 !border !border-slate-300 !rounded-md !px-2 !py-1 !text-xs !font-bold !shadow-lg"
                  >
                    {m.label}
                  </Tooltip>
                  <Popup>{m.label}</Popup>
                </>
              )}
            </Marker>
          );
        })}
        {autoFit && <FitBounds markers={markers} route={route} />}
      </MapContainer>
    </div>
  );
};

export default DriverMap;
