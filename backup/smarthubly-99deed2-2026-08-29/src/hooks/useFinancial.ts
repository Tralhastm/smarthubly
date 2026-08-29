import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type FinancialEntry = Tables<'financial_entries'>;
export type Debt = Tables<'debts'>;

export const useFinancialEntries = (tenantId?: string) => {
  return useQuery({
    queryKey: ['financial_entries', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase.from('financial_entries').select('*').eq('tenant_id', tenantId).order('date', { ascending: false });
      if (error) throw error;
      return data as FinancialEntry[];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useAddFinancialEntry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Omit<TablesInsert<'financial_entries'>, 'id'>) => {
      const { error } = await supabase.from('financial_entries').insert(entry);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['financial_entries', vars.tenant_id] }),
  });
};

export const useUpdateFinancialEntry = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<FinancialEntry> & { id: string }) => {
      const { error } = await supabase.from('financial_entries').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financial_entries', tenantId] }),
  });
};

export const useDeleteFinancialEntry = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('financial_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financial_entries', tenantId] }),
  });
};

export const useDebts = (tenantId?: string) => {
  return useQuery({
    queryKey: ['debts', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase.from('debts').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (error) throw error;
      return data as Debt[];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useAddDebt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (debt: Omit<TablesInsert<'debts'>, 'id'>) => {
      const { error } = await supabase.from('debts').insert(debt);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['debts', vars.tenant_id] }),
  });
};

export const useUpdateDebt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (debt: Debt) => {
      const { error } = await supabase.from('debts').update({ paid: debt.paid, name: debt.name, amount: debt.amount, due_date: debt.due_date, type: debt.type }).eq('id', debt.id);
      if (error) throw error;
      return debt;
    },
    onSuccess: (debt) => qc.invalidateQueries({ queryKey: ['debts', debt.tenant_id] }),
  });
};

export const useDeleteDebt = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('debts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debts', tenantId] }),
  });
};
