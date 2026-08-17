// Hook que calcula rota + ETA do motoboy até o destino usando edge function route-eta (OSRM + Nominatim).
// Recalcula apenas quando o motoboy se moveu mais de THRESHOLD metros, pra economizar requests.
// Cacheia destino geocodificado para reaproveitar entre recálculos.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Args {
  originLat?: number | null;
  originLng?: number | null;
  destAddress?: string | null;
  enabled?: boolean;
  /** Distância mínima (m) que o motoboy precisa andar pra recalcular a rota */
  recomputeThresholdM?: number;
}

interface RouteEtaState {
  polyline: [number, number][] | null;
  distanceM: number | null;
  durationS: number | null;
  destLat: number | null;
  destLng: number | null;
  loading: boolean;
  error: string | null;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const useRouteEta = ({
  originLat,
  originLng,
  destAddress,
  enabled = true,
  recomputeThresholdM = 100,
}: Args) => {
  const [state, setState] = useState<RouteEtaState>({
    polyline: null, distanceM: null, durationS: null,
    destLat: null, destLng: null, loading: false, error: null,
  });
  const lastComputedFromRef = useRef<{ lat: number; lng: number } | null>(null);
  const cachedDestRef = useRef<{ lat: number; lng: number } | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || originLat == null || originLng == null || !destAddress) return;

    // Throttle: só recalcula se moveu mais que o threshold
    const last = lastComputedFromRef.current;
    if (last) {
      const moved = haversine(last.lat, last.lng, originLat, originLng);
      if (moved < recomputeThresholdM && state.polyline) return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState(s => ({ ...s, loading: true, error: null }));

    const cachedDest = cachedDestRef.current;
    const body: any = { originLat, originLng };
    if (cachedDest) {
      body.destLat = cachedDest.lat;
      body.destLng = cachedDest.lng;
    } else {
      body.destAddress = destAddress;
    }

    supabase.functions.invoke('route-eta', { body }).then(({ data, error }) => {
      inFlightRef.current = false;
      if (error || (data as any)?.error) {
        setState(s => ({ ...s, loading: false, error: (data as any)?.error || error?.message || 'falha' }));
        return;
      }
      const d = data as any;
      if (d?.destLat && d?.destLng) {
        cachedDestRef.current = { lat: d.destLat, lng: d.destLng };
      }
      lastComputedFromRef.current = { lat: originLat, lng: originLng };
      setState({
        polyline: d.polyline || null,
        distanceM: d.distanceM ?? null,
        durationS: d.durationS ?? null,
        destLat: d.destLat ?? null,
        destLng: d.destLng ?? null,
        loading: false,
        error: null,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originLat, originLng, destAddress, enabled]);

  // Reset quando endereço muda
  useEffect(() => {
    cachedDestRef.current = null;
    lastComputedFromRef.current = null;
  }, [destAddress]);

  return state;
};

/** Formata segundos em "X min" ou "Xh Ymin" */
export const formatEta = (seconds: number | null) => {
  if (seconds == null) return '—';
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
};

/** Formata metros em "X m" ou "X,Y km" */
export const formatDistance = (meters: number | null) => {
  if (meters == null) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
};
