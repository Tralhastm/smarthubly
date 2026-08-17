import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Appointment = Tables<'appointments'>;

/** Carrega agendamentos do tenant a partir de uma data (default: hoje). */
export const useAppointments = (tenantId?: string, fromDate?: Date) => {
  return useQuery({
    queryKey: ['appointments', tenantId, fromDate?.toISOString().slice(0, 10)],
    queryFn: async () => {
      if (!tenantId) return [];
      const from = fromDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // ontem em diante
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('scheduled_start', from.toISOString())
        .order('scheduled_start', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
    enabled: !!tenantId,
    refetchInterval: 15000,
    staleTime: 5000,
  });
};

/** Busca slots ocupados pra um produto específico (pra o cliente ver o que sobrou). */
export const useTenantUpcomingAppointments = (tenantId?: string) => {
  return useQuery({
    queryKey: ['appointments-upcoming', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const now = new Date();
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('scheduled_start', new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString())
        .in('status', ['scheduled', 'in_progress'])
        .order('scheduled_start', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
    enabled: !!tenantId,
    refetchInterval: 20000,
    staleTime: 10000,
  });
};

export const useCreateAppointment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TablesInsert<'appointments'>) => {
      const { data, error } = await supabase.from('appointments').insert(input).select().single();
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['appointments', a.tenant_id] });
      qc.invalidateQueries({ queryKey: ['appointments-upcoming', a.tenant_id] });
    },
  });
};

export const useUpdateAppointment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & TablesUpdate<'appointments'>) => {
      const { data, error } = await supabase.from('appointments').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['appointments', a.tenant_id] });
      qc.invalidateQueries({ queryKey: ['appointments-upcoming', a.tenant_id] });
    },
  });
};
