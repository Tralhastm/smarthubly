import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

export type CreditAccount = {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  amount: number;
  amount_paid: number;
  description: string;
  due_date: string;
  status: 'open' | 'paid' | 'overdue' | 'defaulted';
  reminders_sent: number;
  last_reminder_at: string | null;
  notes: string;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreditPayment = {
  id: string;
  credit_account_id: string;
  tenant_id: string;
  amount: number;
  note: string;
  paid_at: string;
  created_at: string;
};

export type RiskScore = {
  score: number; // 0-100, quanto maior pior
  label: 'novo' | 'bom' | 'atencao' | 'ruim' | 'calote';
  reason: string;
};

const norm = (s: string) => (s || '').replace(/\D/g, '').trim();

export function computeRisk(history: CreditAccount[]): RiskScore {
  if (history.length === 0) {
    return { score: 0, label: 'novo', reason: 'Cliente novo, sem histórico' };
  }
  const total = history.length;
  const defaulted = history.filter(h => h.status === 'defaulted').length;
  const overdue = history.filter(h => h.status === 'overdue').length;
  const paidLate = history.filter(h => {
    if (h.status !== 'paid' || !h.paid_at) return false;
    return new Date(h.paid_at).getTime() > new Date(h.due_date).getTime() + 86400000;
  }).length;
  const paidOnTime = history.filter(h => h.status === 'paid' && !paidLate).length;

  const reminders = history.reduce((s, h) => s + (h.reminders_sent || 0), 0);

  let score = 0;
  score += defaulted * 40;
  score += overdue * 25;
  score += paidLate * 10;
  score += reminders * 3;
  score = Math.min(100, score);

  let label: RiskScore['label'] = 'bom';
  let reason = `${total} compra${total > 1 ? 's' : ''}, ${paidOnTime} em dia`;

  if (defaulted > 0) {
    label = 'calote';
    reason = `🚨 ${defaulted} calote${defaulted > 1 ? 's' : ''} confirmado${defaulted > 1 ? 's' : ''}!`;
  } else if (overdue >= 2 || score >= 60) {
    label = 'ruim';
    reason = `⚠️ ${overdue} fiado${overdue > 1 ? 's' : ''} em atraso atualmente`;
  } else if (overdue >= 1 || paidLate >= 2 || score >= 30) {
    label = 'atencao';
    reason = `Já atrasou ${paidLate + overdue}x — atenção`;
  }

  return { score, label, reason };
}

export const useCreditAccounts = (tenantId?: string) => {
  return useQuery({
    queryKey: ['credit_accounts', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      // Marca atrasados primeiro
      try { await (supabase as any).rpc('mark_overdue_credits'); } catch {}
      const { data, error } = await (supabase as any)
        .from('credit_accounts')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as CreditAccount[];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useAddCreditAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<CreditAccount, 'id' | 'amount_paid' | 'status' | 'reminders_sent' | 'last_reminder_at' | 'paid_at' | 'created_at' | 'updated_at'>) => {
      const { data: row, error } = await (supabase as any)
        .from('credit_accounts')
        .insert(data)
        .select()
        .single();
      if (error) throw error;
      return row;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['credit_accounts', vars.tenant_id] }),
  });
};

export const useUpdateCreditAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CreditAccount> & { id: string }) => {
      const { error } = await (supabase as any).from('credit_accounts').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit_accounts'] }),
  });
};

export const useDeleteCreditAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('credit_accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit_accounts'] }),
  });
};

export const useAddCreditPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, tenantId, amount, note, currentPaid, totalAmount }: {
      accountId: string; tenantId: string; amount: number; note: string; currentPaid: number; totalAmount: number;
    }) => {
      const { error: payErr } = await (supabase as any).from('credit_payments').insert({
        credit_account_id: accountId, tenant_id: tenantId, amount, note,
      });
      if (payErr) throw payErr;
      const newPaid = currentPaid + amount;
      const fullyPaid = newPaid >= totalAmount;
      const { error: updErr } = await (supabase as any).from('credit_accounts').update({
        amount_paid: newPaid,
        status: fullyPaid ? 'paid' : 'open',
        paid_at: fullyPaid ? new Date().toISOString() : null,
      }).eq('id', accountId);
      if (updErr) throw updErr;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit_accounts'] }),
  });
};

export const useSendCreditReminder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, testEmail }: { accountId: string; testEmail?: string }) => {
      const { data, error } = await unifiedInvoke("notify-unified", "send-credit", { credit_account_id: accountId, test_email: testEmail });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit_accounts'] }),
  });
};

// Lookup risk pelo telefone (chamado ao criar novo fiado)
export function findCustomerHistory(all: CreditAccount[], phone: string, email: string): CreditAccount[] {
  const p = norm(phone);
  const e = (email || '').toLowerCase().trim();
  return all.filter(a => {
    if (p && norm(a.customer_phone) === p) return true;
    if (e && a.customer_email.toLowerCase().trim() === e) return true;
    return false;
  });
}
