import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type Supplier = Tables<'suppliers'> & {
  lalamove_api_key?: string;
  lalamove_api_secret?: string;
  lalamove_market?: string;
  lalamove_sandbox?: boolean;
  lalamove_use_store_api?: string;
  shipping_base_fee?: number;
  shipping_base_radius_km?: number;
  shipping_per_km_fee?: number;
};

export const useSuppliers = (tenantId?: string) => {
  return useQuery({
    queryKey: ['suppliers', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase.from('suppliers').select('*').eq('tenant_id', tenantId).order('created_at');
      if (error) throw error;
      return data as Supplier[];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useSupplierByToken = (token?: string) => {
  return useQuery({
    queryKey: ['supplier-token', token],
    queryFn: async () => {
      if (!token) return null;
      const { data, error } = await (supabase as any).rpc('get_supplier_by_token', { _token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as Supplier | null) || null;
    },
    enabled: !!token,
  });
};

export const useAddSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (supplier: { tenant_id: string; name: string; address: string; phone: string; responsible_for_delivery: boolean }) => {
      const { error } = await supabase.from('suppliers').insert(supplier);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['suppliers', vars.tenant_id] }),
  });
};

export const useUpdateSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: Supplier) => {
      const payload: Record<string, unknown> = {
        name: s.name, address: s.address, phone: s.phone,
        responsible_for_delivery: s.responsible_for_delivery, active: s.active,
      };
      if (s.shipping_base_fee !== undefined) payload.shipping_base_fee = s.shipping_base_fee;
      if (s.shipping_base_radius_km !== undefined) payload.shipping_base_radius_km = s.shipping_base_radius_km;
      if (s.shipping_per_km_fee !== undefined) payload.shipping_per_km_fee = s.shipping_per_km_fee;
      const { error } = await supabase.from('suppliers').update(payload as any).eq('id', s.id);
      if (error) throw error;
      return s;
    },
    onSuccess: (s) => qc.invalidateQueries({ queryKey: ['suppliers', s.tenant_id] }),
  });
};

export const useUpdateSupplierStoreApiStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ supplierId, status, tenantId }: { supplierId: string; status: 'approved' | 'revoked' | 'none'; tenantId: string }) => {
      const { error } = await supabase.from('suppliers').update({
        lalamove_use_store_api: status,
      } as any).eq('id', supplierId);
      if (error) throw error;
      return { tenantId };
    },
    onSuccess: (r) => qc.invalidateQueries({ queryKey: ['suppliers', r.tenantId] }),
  });
};

export const useDeleteSupplier = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers', tenantId] }),
  });
};
