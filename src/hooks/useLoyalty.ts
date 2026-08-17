import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useLoyaltyPoints = (tenantId: string, address: string) => {
  return useQuery({
    queryKey: ['loyalty', tenantId, address],
    queryFn: async () => {
      if (!address || !tenantId) return 0;
      const { data } = await (supabase as any).rpc('get_loyalty_points', {
        _tenant_id: tenantId,
        _address: address,
      });
      return (data as number) || 0;
    },
    enabled: !!address && !!tenantId,
  });
};

export const useAddLoyaltyPoint = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenantId, address }: { tenantId: string; address: string }) => {
      const { data } = await (supabase as any).rpc('register_loyalty_point', {
        _tenant_id: tenantId,
        _address: address,
      });
      return (data as number) || 1;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loyalty'] }),
  });
};
