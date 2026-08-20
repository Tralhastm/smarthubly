// Hook para configurações fiscais e emissão de NFC-e.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { unifiedInvoke } from "@/lib/unifiedInvoke";

export type FiscalProvider = "webmania" | "plugnotas" | "focusnfe" | "nfeio";
export type FiscalEnvironment = "sandbox" | "production";
export type FiscalInvoiceStatus = "pending" | "processing" | "authorized" | "rejected" | "cancelled";

export interface FiscalSettings {
  id: string;
  tenant_id: string;
  provider: FiscalProvider;
  environment: FiscalEnvironment;
  enabled: boolean;
  api_token?: string | null;
  consumer_key?: string | null;
  consumer_secret?: string | null;
  access_token?: string | null;
  access_token_secret?: string | null;
  cnpj?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  inscricao_estadual?: string | null;
  inscricao_municipal?: string | null;
  regime_tributario?: string | null;
  cnae?: string | null;
  endereco_logradouro?: string | null;
  endereco_numero?: string | null;
  endereco_complemento?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_uf?: string | null;
  endereco_cep?: string | null;
  endereco_codigo_municipio?: string | null;
  cfop_padrao?: string | null;
  ncm_padrao?: string | null;
  cest_padrao?: string | null;
  origem_padrao?: string | null;
  csosn_padrao?: string | null;
  cst_padrao?: string | null;
  unidade_padrao?: string | null;
  serie_nfce: number;
  proximo_numero_nfce: number;
  csc_id?: string | null;
  csc_token?: string | null;
  nfeio_company_id?: string | null;
}

export interface FiscalInvoice {
  id: string;
  tenant_id: string;
  order_id: string | null;
  provider: string;
  environment: string;
  tipo: string;
  numero: number | null;
  serie: number | null;
  chave_acesso: string | null;
  protocolo: string | null;
  status: FiscalInvoiceStatus;
  total: number | null;
  xml_url: string | null;
  pdf_url: string | null;
  qr_code: string | null;
  error_message: string | null;
  emitted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export const useFiscalSettings = (tenantId?: string) => {
  return useQuery({
    queryKey: ["fiscal_settings", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data } = await (supabase as any)
        .from("fiscal_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return data as FiscalSettings | null;
    },
    enabled: !!tenantId,
  });
};

export const useUpsertFiscalSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<FiscalSettings> & { tenant_id: string }) => {
      const { data: existing } = await (supabase as any)
        .from("fiscal_settings")
        .select("id")
        .eq("tenant_id", input.tenant_id)
        .maybeSingle();
      if (existing?.id) {
        const { error } = await (supabase as any)
          .from("fiscal_settings")
          .update(input)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("fiscal_settings").insert(input);
        if (error) throw error;
      }
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["fiscal_settings", v.tenant_id] });
      toast.success("Configurações fiscais salvas");
    },
    onError: (e: any) => toast.error(e.message || "Erro ao salvar"),
  });
};

export const useOrderFiscalInvoice = (orderId?: string) => {
  return useQuery({
    queryKey: ["fiscal_invoice", orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data } = await (supabase as any)
        .from("fiscal_invoices")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as FiscalInvoice | null;
    },
    enabled: !!orderId,
  });
};

export const useEmitNFCe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, tenantId }: { orderId: string; tenantId: string }) => {
      const { data, error } = await unifiedInvoke("fiscal-unified", "emit", { orderId, tenantId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Erro ao emitir nota");
      return data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["fiscal_invoice", vars.orderId] });
      if (data.alreadyEmitted) {
        toast.info("Nota já foi emitida para este pedido");
      } else {
        toast.success("NFC-e emitida com sucesso!");
      }
    },
    onError: (e: any) => toast.error(e.message || "Erro ao emitir NFC-e"),
  });
};
