// Hook para captura de GPS do motoboy.
// Usa watchPosition para receber updates contínuos do navegador.
// Pede Wake Lock para evitar que a tela durma (quando suportado).
// Envia para edge function update-driver-location a cada update significativo (>10m ou >15s).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Options {
  driverToken?: string;
  enabled: boolean;
  /** Distância mínima em metros entre updates enviados ao servidor */
  minDistanceMeters?: number;
  /** Intervalo mínimo em ms entre updates */
  minIntervalMs?: number;
}

interface State {
  permission: 'unknown' | 'granted' | 'denied' | 'prompt';
  lastUpdate: Date | null;
  lastPosition: { lat: number; lng: number } | null;
  error: string | null;
  watching: boolean;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const useDriverTracking = ({ driverToken, enabled, minDistanceMeters = 10, minIntervalMs = 15000 }: Options) => {
  const [state, setState] = useState<State>({
    permission: 'unknown',
    lastUpdate: null,
    lastPosition: null,
    error: null,
    watching: false,
  });
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled || !driverToken || typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      // Cleanup if previously watching
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      setState(s => ({ ...s, watching: false }));
      return;
    }

    let cancelled = false;

    // Solicita Wake Lock para manter tela ativa enquanto roda
    const acquireWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          // @ts-ignore
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch { /* não suportado / negado */ }
    };
    acquireWakeLock();
    const visHandler = () => {
      if (document.visibilityState === 'visible') acquireWakeLock();
    };
    document.addEventListener('visibilitychange', visHandler);

    const sendUpdate = async (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy, heading, speed } = pos.coords;
      const now = Date.now();
      const last = lastSentRef.current;
      if (last) {
        const dist = haversine(last.lat, last.lng, latitude, longitude);
        const dt = now - last.t;
        if (dist < minDistanceMeters && dt < minIntervalMs) return; // throttle
      }
      lastSentRef.current = { lat: latitude, lng: longitude, t: now };
      try {
        await supabase.functions.invoke('update-driver-location', {
          body: {
            token: driverToken,
            lat: latitude,
            lng: longitude,
            accuracy: accuracy ?? null,
            heading: heading ?? null,
            speed: speed ?? null,
          },
        });
        if (!cancelled) setState(s => ({ ...s, lastUpdate: new Date(), lastPosition: { lat: latitude, lng: longitude }, error: null }));
      } catch (e: any) {
        if (!cancelled) setState(s => ({ ...s, error: e?.message || 'falha ao enviar' }));
      }
    };

    const onError = (err: GeolocationPositionError) => {
      const map: Record<number, State['permission']> = { 1: 'denied' };
      if (!cancelled) setState(s => ({ ...s, error: err.message, permission: map[err.code] || s.permission, watching: false }));
    };

    setState(s => ({ ...s, watching: true, error: null }));
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!cancelled) setState(s => ({
          ...s,
          permission: 'granted',
          lastPosition: { lat: latitude, lng: longitude },
        }));
        sendUpdate(pos);
      },
      onError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );

    return () => {
      cancelled = true;
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      document.removeEventListener('visibilitychange', visHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverToken, enabled]);

  return state;
};
