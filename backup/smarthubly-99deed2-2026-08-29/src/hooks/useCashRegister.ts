// Hook do caixa: sessão aberta, movimentações, abrir/fechar.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CashSession = {
  id: string;
  tenant_id: string;
  operator_name: string;
  operator_role: string | null;
  opened_at: string;
  opening_amount: number;
  closed_at: string | null;
  closing_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  status: "open" | "closed";
  notes: string | null;
  closed_by: string | null;
};

export type CashMovement = {
  id: string;
  session_id: string;
  tenant_id: string;
  type: "sangria" | "suprimento" | "ajuste";
  amount: number;
  reason: string | null;
  operator_name: string | null;
  created_at: string;
};

export function useOpenCashSession(tenantId?: string) {
  return useQuery({
    queryKey: ["cash_session_open", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data, error } = await (supabase as any)
        .from("cash_register_sessions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as CashSession) ?? null;
    },
    enabled: !!tenantId,
    refetchInterval: 15000,
  });
}

export function useCashMovements(sessionId?: string) {
  return useQuery({
    queryKey: ["cash_movements", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await (supabase as any)
        .from("cash_movements")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as CashMovement[]) ?? [];
    },
    enabled: !!sessionId,
    refetchInterval: 15000,
  });
}

export function useSessionExpected(sessionId?: string) {
  return useQuery({
    queryKey: ["cash_expected", sessionId],
    queryFn: async () => {
      if (!sessionId) return 0;
      const { data, error } = await (supabase as any).rpc("calc_cash_session_expected", { _session_id: sessionId });
      if (error) throw error;
      return Number(data) || 0;
    },
    enabled: !!sessionId,
    refetchInterval: 15000,
  });
}

export function useOpenCash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tenantId: string; operatorName: string; operatorRole?: string; openingAmount: number; notes?: string }) => {
      const { data, error } = await (supabase as any)
        .from("cash_register_sessions")
        .insert({
          tenant_id: input.tenantId,
          operator_name: input.operatorName,
          operator_role: input.operatorRole ?? null,
          opening_amount: input.openingAmount,
          notes: input.notes ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as CashSession;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["cash_session_open", vars.tenantId] }),
  });
}

export function useCloseCash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; closingAmount: number; closedBy: string; notes?: string }) => {
      const { data: expected, error: e1 } = await (supabase as any).rpc("calc_cash_session_expected", { _session_id: input.sessionId });
      if (e1) throw e1;
      const exp = Number(expected) || 0;
      const diff = Number(input.closingAmount) - exp;
      const { error } = await (supabase as any)
        .from("cash_register_sessions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closing_amount: input.closingAmount,
          expected_amount: exp,
          difference: diff,
          closed_by: input.closedBy,
          notes: input.notes ?? null,
        })
        .eq("id", input.sessionId);
      if (error) throw error;
      return { expected: exp, difference: diff };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cash_session_open"] }),
  });
}

export function useAddCashMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: { sessionId: string; tenantId: string; type: CashMovement["type"]; amount: number; reason?: string; operatorName: string }) => {
      const { error } = await (supabase as any).from("cash_movements").insert({
        session_id: m.sessionId,
        tenant_id: m.tenantId,
        type: m.type,
        amount: m.amount,
        reason: m.reason ?? null,
        operator_name: m.operatorName,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["cash_movements", vars.sessionId] });
      qc.invalidateQueries({ queryKey: ["cash_expected", vars.sessionId] });
    },
  });
}
