import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// =============== Conciliação de adquirente ===============
export type AcquirerRow = {
  id: string;
  tenant_id: string;
  acquirer: string;
  transaction_date: string;
  authorization_code: string | null;
  nsu: string | null;
  card_brand: string | null;
  installments: number | null;
  gross_amount: number;
  fee_amount: number | null;
  net_amount: number;
  expected_settlement_date: string | null;
  actual_settlement_date: string | null;
  matched_order_id: string | null;
  status: 'pending' | 'matched' | 'divergent' | 'settled';
  divergence_reason: string | null;
};

export function useAcquirerReconciliations(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['acquirer-rec', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('acquirer_reconciliations')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('transaction_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as AcquirerRow[];
    },
  });
}

export function useImportAcquirerCSV(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ acquirer, rows }: { acquirer: string; rows: any[] }) => {
      if (!tenantId) throw new Error('no tenant');
      const payload = rows.map((r) => ({
        tenant_id: tenantId,
        acquirer,
        transaction_date: r.transaction_date,
        authorization_code: r.authorization_code ?? null,
        nsu: r.nsu ?? null,
        card_brand: r.card_brand ?? null,
        installments: Number(r.installments || 1),
        gross_amount: Number(r.gross_amount || 0),
        fee_amount: Number(r.fee_amount || 0),
        net_amount: Number(r.net_amount || r.gross_amount || 0),
        expected_settlement_date: r.expected_settlement_date || null,
        status: 'pending' as const,
        raw_data: r,
      }));
      const { error } = await supabase.from('acquirer_reconciliations').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acquirer-rec', tenantId] }),
  });
}

export function useMatchAcquirer(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, orderId, status, reason }: { id: string; orderId?: string | null; status: AcquirerRow['status']; reason?: string }) => {
      const { error } = await supabase
        .from('acquirer_reconciliations')
        .update({ matched_order_id: orderId ?? null, status, divergence_reason: reason ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acquirer-rec', tenantId] }),
  });
}

// =============== Contas a pagar/receber ===============
export type APRRow = {
  id: string;
  tenant_id: string;
  kind: 'payable' | 'receivable';
  description: string;
  category: string | null;
  amount: number;
  due_date: string;
  paid: boolean;
  paid_at: string | null;
  payment_method: string | null;
  supplier_or_payer: string | null;
  recurrence: string | null;
  recurrence_until: string | null;
  alert_days_before: number | null;
  notes: string | null;
};

export function useAPR(tenantId: string | undefined, kind?: 'payable' | 'receivable') {
  return useQuery({
    queryKey: ['apr', tenantId, kind],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from('accounts_payable_receivable')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('due_date', { ascending: true })
        .limit(500);
      if (kind) q = q.eq('kind', kind);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as APRRow[];
    },
  });
}

export function useUpsertAPR(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<APRRow> & { kind: 'payable' | 'receivable'; description: string; amount: number; due_date: string }) => {
      if (!tenantId) throw new Error('no tenant');
      const payload = { ...row, tenant_id: tenantId };
      if (row.id) {
        const { error } = await supabase.from('accounts_payable_receivable').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('accounts_payable_receivable').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apr', tenantId] }),
  });
}

export function useMarkPaidAPR(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { error } = await supabase
        .from('accounts_payable_receivable')
        .update({ paid, paid_at: paid ? new Date().toISOString() : null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apr', tenantId] }),
  });
}

export function useDeleteAPR(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('accounts_payable_receivable').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apr', tenantId] }),
  });
}

// =============== Fluxo de caixa projetado ===============
export function useCashFlowProjection(tenantId: string | undefined, days = 30) {
  return useQuery({
    queryKey: ['cashflow-proj', tenantId, days],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cash_flow_projection', { _tenant_id: tenantId!, _days: days });
      if (error) throw error;
      return (data || []) as Array<{ d: string; projected_in: number; projected_out: number; net: number; accumulated: number }>;
    },
  });
}

// =============== DRE comparativo ===============
export function useDREComparison(tenantId: string | undefined, months = 6) {
  return useQuery({
    queryKey: ['dre-comp', tenantId, months],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dre_comparison', { _tenant_id: tenantId!, _months: months });
      if (error) throw error;
      return (data || []) as Array<{ month_start: string; revenue: number; cmv: number; platform_fee: number; expenses: number; net_profit: number }>;
    },
  });
}
