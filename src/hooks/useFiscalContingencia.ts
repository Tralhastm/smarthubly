// Hooks para contingência fiscal (offline NFC-e + cancelamento + SAT)
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface OfflineQueueRow {
  id: string;
  tenant_id: string;
  order_id: string | null;
  payload: any;
  status: "queued" | "processing" | "emitted" | "failed";
  attempts: number;
  last_error: string | null;
  enqueued_at: string;
  processed_at: string | null;
}

export interface CancellationRow {
  id: string;
  tenant_id: string;
  kind: "cancel" | "invalidate";
  invoice_id: string | null;
  numero_inicial: number | null;
  numero_final: number | null;
  serie: number | null;
  justificativa: string;
  protocolo: string | null;
  status: "pending" | "success" | "failed";
  error_message: string | null;
  performed_at: string;
}

export const useOfflineQueue = (tenantId?: string) => {
  return useQuery({
    queryKey: ["fiscal_offline_queue", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fiscal_offline_queue")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("enqueued_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as OfflineQueueRow[];
    },
    refetchInterval: 15000,
  });
};

export const useEnqueueOfflineNFCe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { tenantId: string; orderId: string; payload?: any }) => {
      const { data, error } = await (supabase as any).rpc("enqueue_offline_nfce", {
        _tenant_id: vars.tenantId,
        _order_id: vars.orderId,
        _payload: vars.payload ?? {},
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, v) => {
      qc.invalidateQueries({ queryKey: ["fiscal_offline_queue", v.tenantId] });
      toast.success("NFC-e enfileirada para emissão quando voltar a conexão");
    },
    onError: (e: any) => toast.error(e.message || "Erro ao enfileirar"),
  });
};

export const useProcessOfflineQueue = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId: string) => {
      const { data, error } = await supabase.functions.invoke("process-offline-nfce-queue", {
        body: { tenantId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, tenantId) => {
      qc.invalidateQueries({ queryKey: ["fiscal_offline_queue", tenantId] });
      toast.success("Fila processada");
    },
    onError: (e: any) => toast.error(e.message || "Erro ao processar fila"),
  });
};

export const useCancellations = (tenantId?: string) => {
  return useQuery({
    queryKey: ["fiscal_cancellations", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fiscal_cancellations")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("performed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as CancellationRow[];
    },
  });
};

export const useCancelNFCe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { tenantId: string; invoiceId: string; justificativa: string }) => {
      if (vars.justificativa.trim().length < 15) {
        throw new Error("Justificativa deve ter ao menos 15 caracteres");
      }
      const { data, error } = await (supabase as any).from("fiscal_cancellations").insert({
        tenant_id: vars.tenantId,
        kind: "cancel",
        invoice_id: vars.invoiceId,
        justificativa: vars.justificativa,
        status: "pending",
      }).select().single();
      if (error) throw error;
      // Dispara função de cancelamento (best-effort)
      try {
        await supabase.functions.invoke("cancel-nfce", {
          body: { cancellationId: data.id, tenantId: vars.tenantId, invoiceId: vars.invoiceId },
        });
      } catch {}
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["fiscal_cancellations", v.tenantId] });
      qc.invalidateQueries({ queryKey: ["fiscal_invoice"] });
      toast.success("Cancelamento solicitado");
    },
    onError: (e: any) => toast.error(e.message),
  });
};

export const useInvalidateNumeros = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { tenantId: string; serie: number; inicio: number; fim: number; justificativa: string }) => {
      if (vars.justificativa.trim().length < 15) throw new Error("Justificativa deve ter ao menos 15 caracteres");
      if (vars.fim < vars.inicio) throw new Error("Número final deve ser ≥ inicial");
      const { data, error } = await (supabase as any).from("fiscal_cancellations").insert({
        tenant_id: vars.tenantId,
        kind: "invalidate",
        serie: vars.serie,
        numero_inicial: vars.inicio,
        numero_final: vars.fim,
        justificativa: vars.justificativa,
        status: "pending",
      }).select().single();
      if (error) throw error;
      try {
        await supabase.functions.invoke("invalidate-nfce-range", {
          body: { cancellationId: data.id, tenantId: vars.tenantId },
        });
      } catch {}
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["fiscal_cancellations", v.tenantId] });
      toast.success("Inutilização solicitada");
    },
    onError: (e: any) => toast.error(e.message),
  });
};

export const useCanCancel = (invoiceId?: string) => {
  return useQuery({
    queryKey: ["can_cancel_nfce", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("can_cancel_nfce", { _invoice_id: invoiceId });
      return !!data;
    },
    refetchInterval: 30000,
  });
};
