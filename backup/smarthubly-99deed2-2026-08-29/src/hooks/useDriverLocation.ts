// Hook para escutar localização de um motoboy em tempo real (cliente/lojista).
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DriverLocation {
  driver_id: string;
  tenant_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  updated_at: string;
}

export const useDriverLocation = (driverId?: string | null) => {
  const [location, setLocation] = useState<DriverLocation | null>(null);

  useEffect(() => {
    if (!driverId) { setLocation(null); return; }

    let cancelled = false;
    // initial fetch
    (supabase as any).from('driver_locations').select('*').eq('driver_id', driverId).maybeSingle().then(({ data }: any) => {
      if (!cancelled && data) setLocation(data as DriverLocation);
    });

    const channel = supabase
      .channel(`driver-loc-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` },
        (payload: any) => {
          if (!cancelled && payload.new) setLocation(payload.new as DriverLocation);
        })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [driverId]);

  return location;
};

export const useTenantDriverLocations = (tenantId?: string | null) => {
  const [locations, setLocations] = useState<DriverLocation[]>([]);

  useEffect(() => {
    if (!tenantId) { setLocations([]); return; }

    let cancelled = false;
    (supabase as any).from('driver_locations').select('*').eq('tenant_id', tenantId).then(({ data }: any) => {
      if (!cancelled && data) setLocations(data as DriverLocation[]);
    });

    const channel = supabase
      .channel(`tenant-driver-locs-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `tenant_id=eq.${tenantId}` },
        (payload: any) => {
          if (cancelled) return;
          setLocations(prev => {
            if (payload.eventType === 'DELETE') {
              return prev.filter(l => l.driver_id !== payload.old?.driver_id);
            }
            const next = payload.new as DriverLocation;
            const idx = prev.findIndex(l => l.driver_id === next.driver_id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = next;
              return copy;
            }
            return [...prev, next];
          });
        })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [tenantId]);

  return locations;
};
