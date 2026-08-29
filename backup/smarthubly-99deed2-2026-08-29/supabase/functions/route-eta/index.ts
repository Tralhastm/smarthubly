// Edge function: calcula rota e ETA usando OSRM (gratuito) + Nominatim (gratuito) para geocoding.
// Recebe ponto de origem (lat/lng do motoboy) e endereço de destino (texto).
// Devolve polyline da rota, distância em metros e duração estimada em segundos.
//
// Cache simples em memória por instância para evitar recomputar a mesma rota toda hora —
// como o destino é fixo por pedido, só recalculamos quando o motoboy se moveu >100m.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OSRM_BASE = 'https://router.project-osrm.org';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

// Cache de geocoding por endereço (TTL implícito — instância morre em ~15min)
const geocodeCache = new Map<string, { lat: number; lng: number; ts: number }>();
const GEO_TTL_MS = 60 * 60 * 1000; // 1h

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = address.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.ts < GEO_TTL_MS) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const url = `${NOMINATIM_BASE}/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'LovableDeliveryPlatform/1.0 (route-eta function)',
      'Accept-Language': 'pt-BR',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  const lat = parseFloat(first.lat);
  const lng = parseFloat(first.lon);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  geocodeCache.set(key, { lat, lng, ts: Date.now() });
  return { lat, lng };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { originLat, originLng, destAddress, destLat, destLng } = body;

    if (typeof originLat !== 'number' || typeof originLng !== 'number') {
      return new Response(JSON.stringify({ error: 'originLat e originLng obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve destino: ou já vem pronto (preferido) ou geocodifica do endereço
    let dLat: number | null = typeof destLat === 'number' ? destLat : null;
    let dLng: number | null = typeof destLng === 'number' ? destLng : null;

    if (dLat == null || dLng == null) {
      if (!destAddress || typeof destAddress !== 'string') {
        return new Response(JSON.stringify({ error: 'destAddress ou (destLat,destLng) obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const geo = await geocode(destAddress);
      if (!geo) {
        return new Response(JSON.stringify({ error: 'endereço de destino não encontrado' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      dLat = geo.lat;
      dLng = geo.lng;
    }

    // OSRM espera lng,lat (não lat,lng)
    const coords = `${originLng},${originLat};${dLng},${dLat}`;
    const osrmUrl = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const osrmRes = await fetch(osrmUrl);
    if (!osrmRes.ok) {
      return new Response(JSON.stringify({ error: 'OSRM indisponível', status: osrmRes.status }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const osrmData = await osrmRes.json();
    if (osrmData.code !== 'Ok' || !osrmData.routes?.[0]) {
      return new Response(JSON.stringify({ error: 'rota não encontrada', osrm: osrmData.code }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const route = osrmData.routes[0];
    // GeoJSON vem como [lng,lat] — converter pra [lat,lng] que o Leaflet usa
    const polyline: [number, number][] = route.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]]
    );

    return new Response(JSON.stringify({
      ok: true,
      polyline,
      distanceM: route.distance,
      durationS: route.duration,
      destLat: dLat,
      destLng: dLng,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('route-eta error', e);
    return new Response(JSON.stringify({ error: e?.message || 'erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
