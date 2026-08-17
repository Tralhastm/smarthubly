import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type QuoteVariable = Tables<'quote_variables'>;
export type QuotePackage = Tables<'quote_packages'>;

// ===== Variables =====
export const useQuoteVariables = (tenantId?: string) =>
  useQuery({
    queryKey: ['quote_variables', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('quote_variables').select('*')
        .eq('tenant_id', tenantId).order('sort_order').order('created_at');
      if (error) throw error;
      return data as QuoteVariable[];
    },
    enabled: !!tenantId,
  });

export const useUpsertQuoteVariable = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: TablesInsert<'quote_variables'> & { id?: string }) => {
      const { id, ...rest } = v;
      if (id) {
        const { error } = await supabase.from('quote_variables').update(rest as TablesUpdate<'quote_variables'>).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('quote_variables').insert(rest);
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['quote_variables', v.tenant_id] }),
  });
};

export const useDeleteQuoteVariable = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; tenant_id: string }) => {
      const { error } = await supabase.from('quote_variables').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['quote_variables', v.tenant_id] }),
  });
};

// ===== Packages =====
export const useQuotePackages = (tenantId?: string) =>
  useQuery({
    queryKey: ['quote_packages', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('quote_packages').select('*')
        .eq('tenant_id', tenantId).order('sort_order').order('created_at');
      if (error) throw error;
      return data as QuotePackage[];
    },
    enabled: !!tenantId,
  });

export const useUpsertQuotePackage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: TablesInsert<'quote_packages'> & { id?: string }) => {
      const { id, ...rest } = p;
      if (id) {
        const { error } = await supabase.from('quote_packages').update(rest as TablesUpdate<'quote_packages'>).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('quote_packages').insert(rest);
        if (error) throw error;
      }
    },
    onSuccess: (_d, p) => qc.invalidateQueries({ queryKey: ['quote_packages', p.tenant_id] }),
  });
};

export const useDeleteQuotePackage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; tenant_id: string }) => {
      const { error } = await supabase.from('quote_packages').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['quote_packages', v.tenant_id] }),
  });
};
