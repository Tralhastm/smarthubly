// Mapa Leaflet com rota desenhada (OSRM público — grátis, sem chave).
// Mostra posição atual do motoboy, destino, e a rota azul entre eles.
// Recalcula rota a cada ~30s ou quando o motoboy se move > 50m.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, Navigation2, Clock, MapPin } from 'lucide-react';

// Fix dos ícones padrão do Leaflet (Vite quebra os assets default)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Ícone customizado pro motoboy (azul pulsante via div)
const driverIcon = L.divIcon({
  className: '',
  html: `<div style="position:relative;width:28px;height:28px;">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.3);animation:driverPulse 1.8s infinite;"></div>
    <div style="position:absolute;inset:6px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>
  </div>
  <style>@keyframes driverPulse{0%{transform:scale(0.8);opacity:1}100%{transform:scale(2.2);opacity:0}}</style>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const destIcon = L.divIcon({
  className: '',
  html: `<div style="width:32px;height:40px;display:flex;align-items:flex-start;justify-content:center;">
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 24 16 24s16-12 16-24C32 7.2 24.8 0 16 0z" fill="#ef4444" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="15" r="6" fill="white"/>
    </svg>
  </div>`,
  iconSize: [32, 40],
  iconAnchor: [16, 40],
});

interface Props {
  destinationAddress: string;
  driverPosition?: { lat: number; lng: number } | null;
}

type LatLng = [number, number];

export const DriverRouteMap = ({ destinationAddress, driverPosition }: Props) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);

  const [destCoords, setDestCoords] = useState<LatLng | null>(null);
  const [currentPos, setCurrentPos] = useState<LatLng | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastRouteFetchRef = useRef<{ pos: LatLng; ts: number } | null>(null);

  // Geocode endereço de destino — estratégia robusta:
  // 1. Extrai CEP do endereço (formato BR comum) → ViaCEP pra normalizar rua/bairro/cidade
  // 2. Tenta variações no Nominatim (com countrycodes=br)
  // 3. Fallback Photon
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const tryNominatim = async (q: string): Promise<LatLng | null> => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`, {
          headers: { 'Accept-Language': 'pt-BR' },
        });
        const data = await r.json();
        if (Array.isArray(data) && data[0]?.lat) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      } catch { /* ignore */ }
      return null;
    };
    const tryPhoton = async (q: string): Promise<LatLng | null> => {
      try {
        const r = await fetch(`https://photon.komoot.io/api/?limit=1&lang=pt&q=${encodeURIComponent(q)}`);
        const data = await r.json();
        const c = data?.features?.[0]?.geometry?.coordinates;
        if (Array.isArray(c)) return [c[1], c[0]];
      } catch { /* ignore */ }
      return null;
    };

    const run = async () => {
      const base = destinationAddress.trim();
      const variations: string[] = [];

      // 1. Extrai CEP (formato 12345-678 ou 12345678) → ViaCEP normaliza
      const cepMatch = base.match(/(\d{5})-?(\d{3})/);
      if (cepMatch) {
        const cep = cepMatch[1] + cepMatch[2];
        try {
          const viacep = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then(r => r.json());
          if (!viacep.erro && viacep.logradouro) {
            // Tenta com número original se houver
            const numMatch = base.match(/,\s*(\d+)/);
            const num = numMatch ? `, ${numMatch[1]}` : '';
            variations.push(`${viacep.logradouro}${num}, ${viacep.bairro}, ${viacep.localidade}, ${viacep.uf}`);
            variations.push(`${viacep.logradouro}, ${viacep.localidade}, ${viacep.uf}`);
          }
        } catch { /* viacep falhou, continua */ }
      }

      // 2. Variações limpas do endereço cru (remove CEP / sufixos quebrados)
      const noCep = base.replace(/-?\s*CEP\s*\d{5}-?\d{3}/i, '').replace(/\d{5}-?\d{3}/, '').trim();
      // Substitui " - " por ", " (formato BR comum: "Rua X, 123 - Bairro - Cidade - UF")
      const normalized = noCep.replace(/\s*-\s*/g, ', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '');
      variations.push(normalized);

      // Pega só rua + cidade (1ª e penúltima parte se tiver UF no fim)
      const parts = normalized.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        // [rua, num, bairro, cidade, uf] — usa rua + cidade
        const cidade = parts[parts.length - 2] || parts[parts.length - 1];
        variations.push(`${parts[0]}, ${cidade}`);
      }

      const unique = Array.from(new Set(variations.filter(Boolean)));

      for (const v of unique) {
        const result = (await tryNominatim(v)) || (await tryPhoton(v));
        if (cancelled) return;
        if (result) {
          setDestCoords(result);
          setLoading(false);
          return;
        }
      }
      if (!cancelled) {
        setError('Endereço não encontrado — use "Abrir no app GPS"');
        setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [destinationAddress]);

  // Pega posição atual do motoboy (do prop ou do navegador)
  useEffect(() => {
    if (driverPosition) {
      setCurrentPos([driverPosition.lat, driverPosition.lng]);
      return;
    }
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setCurrentPos([pos.coords.latitude, pos.coords.longitude]),
      () => { /* ignora — vai cair no fallback de só mostrar destino */ },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [driverPosition]);

  // Inicializa o mapa
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Limpa o container antes de instanciar — evita resíduo de um mapa
    // anterior que não foi removido completamente (causa controles "duplicados").
    const containerEl = containerRef.current;
    containerEl.innerHTML = '';
    // Remove a flag interna do Leaflet pra permitir reusar o mesmo nó DOM.
    // Sem isso, Leaflet lança "Map container is already initialized".
    delete (containerEl as any)._leaflet_id;

    const map = L.map(containerEl, {
      zoomControl: true,
      attributionControl: false,
    }).setView([-15.78, -47.93], 4); // Brasil center default

    // Tile layer CLARO com ruas bem destacadas — fundo branco + labels escuros
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    mapRef.current = map;

    // invalida tamanho depois do mount (resolve mapa cinza dentro de modais)
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      // Limpa qualquer resíduo de DOM (controles, panes) que tenham sido
      // criados antes do remove() — protege contra "controles duplicados"
      // se o effect rodar novamente no mesmo container.
      try { containerEl.innerHTML = ''; delete (containerEl as any)._leaflet_id; } catch { /* noop */ }
    };
  }, []);


  // Atualiza marcadores e enquadra
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !destCoords) return;

    // Destino
    if (!destMarkerRef.current) {
      destMarkerRef.current = L.marker(destCoords, { icon: destIcon }).addTo(map);
    } else {
      destMarkerRef.current.setLatLng(destCoords);
    }

    // Motoboy
    if (currentPos) {
      if (!driverMarkerRef.current) {
        driverMarkerRef.current = L.marker(currentPos, { icon: driverIcon, zIndexOffset: 1000 }).addTo(map);
      } else {
        driverMarkerRef.current.setLatLng(currentPos);
      }
    }

    // Enquadra ambos
    if (currentPos) {
      const bounds = L.latLngBounds([currentPos, destCoords]);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    } else {
      map.setView(destCoords, 16);
    }
  }, [destCoords, currentPos]);

  // Calcula rota via OSRM (público, grátis)
  useEffect(() => {
    if (!currentPos || !destCoords) return;

    // Não recalcula se moveu < 50m e faz menos de 30s
    const last = lastRouteFetchRef.current;
    if (last) {
      const distM = L.latLng(last.pos).distanceTo(currentPos);
      const ageMs = Date.now() - last.ts;
      if (distM < 50 && ageMs < 30_000) return;
    }
    lastRouteFetchRef.current = { pos: currentPos, ts: Date.now() };

    const url = `https://router.project-osrm.org/route/v1/driving/${currentPos[1]},${currentPos[0]};${destCoords[1]},${destCoords[0]}?overview=full&geometries=geojson`;
    let cancelled = false;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data?.routes?.[0]) return;
        const route = data.routes[0];
        const coords: LatLng[] = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
        const map = mapRef.current;
        if (!map) return;

        if (routeLineRef.current) routeLineRef.current.remove();
        // Linha base mais grossa pra criar contorno branco
        const outline = L.polyline(coords, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(map);
        const line = L.polyline(coords, { color: '#3b82f6', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
        // Salva grupo via outra estratégia: armazena só a linha, mas adiciona outline antes
        routeLineRef.current = line;
        // Hack: ao remover routeLineRef, remove também outline
        (routeLineRef.current as any)._outline = outline;

        setRouteInfo({
          distanceKm: route.distance / 1000,
          durationMin: route.duration / 60,
        });
      })
      .catch(() => { /* silencioso, o usuário ainda vê os marcadores */ });

    return () => { cancelled = true; };
  }, [currentPos, destCoords]);

  // Cleanup outline ao trocar rota
  useEffect(() => {
    return () => {
      if (routeLineRef.current && (routeLineRef.current as any)._outline) {
        (routeLineRef.current as any)._outline.remove();
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" style={{ background: '#ffffff' }} />

      {/* Overlay de info da rota (top) */}
      {routeInfo && (
        <div className="absolute top-3 left-3 right-3 z-[400] rounded-xl bg-card/95 backdrop-blur-md border border-border shadow-lg px-4 py-2.5 flex items-center justify-around gap-2">
          <div className="flex items-center gap-1.5 text-foreground">
            <Navigation2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{routeInfo.distanceKm.toFixed(1)} km</span>
          </div>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center gap-1.5 text-foreground">
            <Clock className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{Math.max(1, Math.round(routeInfo.durationMin))} min</span>
          </div>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-4 w-4 text-red-500" />
            <span className="text-xs">Destino</span>
          </div>
        </div>
      )}

      {/* Loader / Error */}
      {loading && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-foreground">Carregando mapa...</span>
          </div>
        </div>
      )}
      {error && !loading && (
        <div className="absolute top-3 left-3 right-3 z-[500] rounded-lg bg-destructive/95 text-destructive-foreground px-3 py-2 text-sm shadow-lg">
          {error}
        </div>
      )}

      {/* Aviso quando não tem GPS */}
      {!loading && !error && !currentPos && destCoords && (
        <div className="absolute bottom-3 left-3 right-3 z-[400] rounded-lg bg-yellow-500/95 text-yellow-950 px-3 py-2 text-xs font-medium shadow-lg flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5" />
          Ative o GPS pra ver a rota desenhada até o destino
        </div>
      )}
    </div>
  );
};
