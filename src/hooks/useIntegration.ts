import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { unifiedInvoke } from "@/lib/unifiedInvoke";
import { isTestOrder } from "@/lib/order-status";

export type IntegrationSettings = Tables<"integration_settings">;

export const useIntegrationSettings = (tenantId?: string) => {
  return useQuery({
    queryKey: ["integration_settings", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data, error } = await supabase
        .from("integration_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as IntegrationSettings;

      // Auto-cria com chave gerada se ainda não existe
      const newKey = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const { data: created, error: insErr } = await supabase
        .from("integration_settings")
        .insert({ tenant_id: tenantId, api_key: newKey })
        .select("*")
        .maybeSingle();
      if (insErr) throw insErr;
      return created as IntegrationSettings | null;
    },
    enabled: !!tenantId,
  });
};

export const useUpsertIntegrationSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<IntegrationSettings> & { tenant_id: string }) => {
      const { data: existing } = await supabase
        .from("integration_settings")
        .select("id")
        .eq("tenant_id", input.tenant_id)
        .maybeSingle();
      if (existing?.id) {
        const { error } = await supabase.from("integration_settings").update(input).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("integration_settings").insert(input as any);
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["integration_settings", vars.tenant_id] }),
  });
};

export const useRotateIntegrationKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId: string) => {
      const newKey = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const { error } = await supabase.from("integration_settings").update({ api_key: newKey }).eq("tenant_id", tenantId);
      if (error) throw error;
      return newKey;
    },
    onSuccess: (_, tenantId) => qc.invalidateQueries({ queryKey: ["integration_settings", tenantId] }),
  });
};

export async function triggerSync(tenantId: string, event: string, data: any) {
  try {
    if (event === "order_delivered" || event === "order_cancelled") {
      const stripOrderMetadata = (order: any) => {
        if (!order || typeof order !== "object") return order;
        const cleanOrder = { ...order };
        delete cleanOrder.metadata;
        return cleanOrder;
      };
      if (Array.isArray(data?.orders)) {
        const orders = data.orders.filter((order: any) => !isTestOrder(order)).map(stripOrderMetadata);
        if (orders.length === 0) return;
        data = { ...data, orders };
      } else if (isTestOrder(data)) {
        return;
      } else {
        data = stripOrderMetadata(data);
      }
    }
    await unifiedInvoke("finance-unified", "sync-financeflow", { tenantId, event, data });
  } catch (e) {
    console.warn("sync-to-financeflow falhou (não-bloqueante):", e);
  }
}
