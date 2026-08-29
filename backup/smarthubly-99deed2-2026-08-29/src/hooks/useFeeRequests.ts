import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface FeeRequest {
  id: string;
  tenant_id: string;
  product_id: string;
  requested_percent: number;
  status: string;
  admin_note: string;
  created_at: string;
  updated_at: string;
}

export const useFeeRequests = (tenantId?: string) => {
  return useQuery({
    queryKey: ['fee_requests', tenantId],
    queryFn: async () => {
      let q = supabase.from('fee_requests').select('*').order('created_at', { ascending: false });
      if (tenantId) q = q.eq('tenant_id', tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return data as FeeRequest[];
    },
    enabled: true,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useCreateFeeRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: { tenant_id: string; product_id: string; requested_percent: number }) => {
      const { error } = await supabase.from('fee_requests').insert(req);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['fee_requests', vars.tenant_id] }),
  });
};

export const useUpdateFeeRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, admin_note }: { id: string; status: string; admin_note?: string }) => {
      const { error } = await supabase.from('fee_requests').update({ status, admin_note: admin_note || '' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee_requests'] });
    },
  });
};
