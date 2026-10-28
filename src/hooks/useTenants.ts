import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type Tenant = Tables<'tenants'>;

// O painel administrativo pode precisar consultar a tabela base quando a view
// pública estiver em cache ou indisponível durante uma troca de sessão. Nunca
// use `select('*')` nesse fallback: a tabela contém tokens e credenciais.
const ADMIN_TENANT_COLUMNS = [
  'id', 'name', 'slug', 'logo_url', 'description', 'niche', 'active',
  'blocked', 'blocked_reason', 'blocked_at', 'store_mode',
  'dropshipping_submode', 'admin_tabs_config', 'storefront_config',
  'scheduling_enabled', 'scheduling_auto_confirm', 'scheduling_open_days',
  'scheduling_open_time', 'scheduling_close_time', 'scheduling_slot_minutes',
  'scheduling_capacity', 'quotes_enabled', 'quotes_feature_enabled',
  'quotes_intro_text', 'printer_enabled', 'billing_blocked_until',
  'created_at', 'updated_at',
].join(',');

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
  const normalizedSlug = slug?.trim();

  return useQuery({
    queryKey: ['tenant', normalizedSlug],
    queryFn: async () => {
      if (!normalizedSlug) return null;
      // Usa view pública (sem secrets como mercadopago_token, lalamove keys, etc.)
      // ilike pra ser case-insensitive (URL pode vir com maiúscula)
      // Bloqueio server-side: loja bloqueada (ex.: fotos irregulares) não é entregue nem ao cliente
      const { data, error } = await (supabase as any)
        .from('tenants_public')
        .select('*')
        .ilike('slug', normalizedSlug)
        .maybeSingle();
      if (error) throw error;
      return data as Tenant | null;
    },
    enabled: !!normalizedSlug,
    refetchInterval: 60000,
    staleTime: 30000,
  });
};

/**
 * Carrega o tenant para o painel administrativo.
 *
 * O storefront deve depender somente de `tenants_public`, mas o admin não
 * pode desaparecer durante uma troca/renovação de sessão por uma falha
 * momentânea dessa view. Nesse caso, tenta a tabela base com uma lista
 * explícita de campos não sensíveis. Isso também evita transformar um erro
 * de transporte/RLS em “Comércio não encontrado”.
 */
export const useAdminTenantBySlug = (slug?: string) => {
  const normalizedSlug = slug?.trim();

  return useQuery({
    queryKey: ['admin-tenant', normalizedSlug],
    queryFn: async () => {
      if (!normalizedSlug) return null;

      const { data: publicTenant, error: publicError } = await (supabase as any)
        .from('tenants_public')
        .select('*')
        .ilike('slug', normalizedSlug)
        .maybeSingle();

      // A view pública pode existir sem admin_tabs_config. O painel precisa
      // mesclar os campos não sensíveis da tabela base para aplicar as regras
      // do Super Admin, sem usar select('*') e sem expor tokens.
      const { data: baseTenant, error: baseError } = await supabase
        .from('tenants')
        .select(ADMIN_TENANT_COLUMNS)
        .ilike('slug', normalizedSlug)
        .maybeSingle();

      if (publicTenant && baseTenant) return { ...publicTenant, ...baseTenant } as Tenant;
      if (publicTenant) return publicTenant as Tenant;

      if (baseError) {
        console.error('[AdminTenant] Falha ao carregar o comércio', { publicError, baseError });
        throw baseError;
      }
      if (!baseTenant && publicError) throw publicError;
      return baseTenant as Tenant | null;
    },
    enabled: !!normalizedSlug,
    retry: 1,
    refetchOnWindowFocus: false,
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
