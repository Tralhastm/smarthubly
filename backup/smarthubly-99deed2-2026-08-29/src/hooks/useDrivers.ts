import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

export type Driver = Tables<'drivers'>;

export const useDrivers = (tenantId?: string) => {
  const qc = useQueryClient();

  // Realtime: invalida cache imediatamente quando o status (online/offline) de qualquer
  // motoboy do tenant mudar — sem isso o admin só veria a mudança no próximo refetch (30s).
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`drivers-${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers', filter: `tenant_id=eq.${tenantId}` },
        () => qc.invalidateQueries({ queryKey: ['drivers', tenantId] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, qc]);

  return useQuery({
    queryKey: ['drivers', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase.from('drivers').select('*').eq('tenant_id', tenantId).order('created_at');
      if (error) throw error;
      return data as Driver[];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useDriverByToken = (token?: string) => {
  return useQuery({
    queryKey: ['driver-token', token],
    queryFn: async () => {
      if (!token) return null;
      const { data, error } = await (supabase as any).rpc('get_driver_by_token', { _token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as Driver | null) || null;
    },
    enabled: !!token,
  });
};

export const useAddDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driver: { tenant_id: string; name: string; phone: string }) => {
      const { error } = await supabase.from('drivers').insert(driver);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['drivers', vars.tenant_id] }),
  });
};

export const useDeleteDriver = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('drivers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers', tenantId] }),
  });
};

// Toggle online/offline para motoboy (chamado do painel do próprio motoboy).
// Usa edge function pra centralizar a lógica (também usada por sendBeacon no unload).
export const setDriverOnline = async (driverId: string, online: boolean, token?: string) => {
  if (token) {
    const { error } = await unifiedInvoke("delivery-unified", "driver-online", { token, online });
    if (error) throw error;
    return;
  }
  // Fallback: update direto (admin alterando status de outro motoboy)
  const update: any = { is_online: online };
  if (online) update.last_online_at = new Date().toISOString();
  const { error } = await supabase.from('drivers').update(update).eq('id', driverId);
  if (error) throw error;
};
