import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type Tenant = Tables<'tenants'>;

export const useTenants = () => {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Tenant[];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
};

export const useTenantBySlug = (slug?: string) => {
  return useQuery({
    queryKey: ['tenant', slug],
    queryFn: async () => {
      if (!slug) return null;
      // Usa view pública (sem secrets como mercadopago_token, lalamove keys, etc.)
      // ilike pra ser case-insensitive (URL pode vir com maiúscula)
      // Bloqueio server-side: loja bloqueada (ex.: fotos irregulares) não é entregue nem ao cliente
      const { data, error } = await (supabase as any)
        .from('tenants_public')
        .select('*')
        .ilike('slug', slug)
        .eq('active', true)
        .eq('blocked', false)
        .maybeSingle();
      if (error) throw error;
      return data as Tenant | null;
    },
    enabled: !!slug,
    refetchInterval: 60000,
    staleTime: 30000,
  });
};

export const slugExists = async (slug: string, excludeId?: string) => {
  const q = supabase.from('tenants').select('id').eq('slug', slug);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).some((t: any) => t.id !== excludeId);
};

export const useAddTenant = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenant: Omit<TablesInsert<'tenants'>, 'id'>) => {
      if (!tenant.slug) throw new Error('Slug é obrigatório');
      if (await slugExists(tenant.slug)) {
        throw new Error(`Slug "${tenant.slug}" já está em uso. Use outro slug.`);
      }
      const { data, error } = await supabase.from('tenants').insert(tenant).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
};

export const useUpdateTenant = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenant: Tenant) => {
      // Update total: envia TODOS os campos do objeto tenant, garantindo que
      // scheduling_enabled, quotes_feature_enabled, fee_mode, fee_split_store_percent,
      // open_* / slot_minutes / capacity, store_mode variantes, monthly_fee e demais
      // campos nunca sejam descartados (era a causa dos toggles/bloqueio que não salvavam).
      const { id, created_at, updated_at, ...rest } = tenant as any;
      const payload: Record<string, any> = { ...rest };
      // Garante defaults não-nulos para colunas NOT NULL
      if (payload.admin_tabs_config === undefined) payload.admin_tabs_config = {};
      if (payload.storefront_config === undefined) payload.storefront_config = {};
      const { error } = await supabase.from('tenants').update(payload).eq('id', tenant.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
};

export const useDeleteTenant = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tenants').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
};
