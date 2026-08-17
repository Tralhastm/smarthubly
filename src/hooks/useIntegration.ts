import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

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
    await supabase.functions.invoke("sync-to-financeflow", { body: { tenantId, event, data } });
  } catch (e) {
    console.warn("sync-to-financeflow falhou (não-bloqueante):", e);
  }
}
