import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type BillingInvoice = {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  orders_count: number;
  amount: number;
  status: 'pending' | 'payment_declared' | 'paid' | 'overdue' | 'cancelled';
  due_date: string;
  paid_at: string | null;
  payment_declared_at: string | null;
  payment_note: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

export const useTenantInvoices = (tenantId?: string) => {
  return useQuery({
    queryKey: ['billing_invoices', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await (supabase as any)
        .from('billing_invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as BillingInvoice[];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useAllInvoices = () => {
  return useQuery({
    queryKey: ['billing_invoices', 'all'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('billing_invoices')
        .select('*, tenants(name, slug)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as (BillingInvoice & { tenants: { name: string; slug: string } })[];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
};

export const useDeclarePayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await (supabase as any)
        .from('billing_invoices')
        .update({ status: 'payment_declared', payment_declared_at: new Date().toISOString(), payment_note: note })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing_invoices'] }),
  });
};

export const useApprovePayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, adminNote }: { id: string; adminNote?: string }) => {
      const { data: inv } = await (supabase as any).from('billing_invoices').select('tenant_id').eq('id', id).single();
      const { error } = await (supabase as any)
        .from('billing_invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString(), admin_note: adminNote || null })
        .eq('id', id);
      if (error) throw error;
      // Clear tenant block if any
      if (inv?.tenant_id) {
        await (supabase as any).from('tenants').update({ billing_blocked_until: null }).eq('id', inv.tenant_id);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing_invoices'] }),
  });
};

export const useGenerateInvoices = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params?: { tenant_id?: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('generate-invoices', { body: params || {} });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing_invoices'] }),
  });
};

export const useTenantBlockStatus = (tenantId?: string) => {
  return useQuery({
    queryKey: ['tenant-block', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data } = await supabase.from('tenants').select('billing_blocked_until').eq('id', tenantId).single();
      const blockedUntil = (data as any)?.billing_blocked_until;
      if (!blockedUntil) return { blocked: false, until: null };
      const isBlocked = new Date(blockedUntil) > new Date();
      return { blocked: isBlocked, until: blockedUntil };
    },
    enabled: !!tenantId,
  });
};
