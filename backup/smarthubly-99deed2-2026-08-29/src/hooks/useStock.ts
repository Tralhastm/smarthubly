// Hooks de estoque profundo: movimentações, inventário e ingredientes em baixa.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StockMovement = {
  id: string;
  tenant_id: string;
  ingredient_id: string;
  type: "entrada" | "saida" | "perda" | "ajuste" | "venda" | "transferencia";
  quantity: number;
  unit_cost: number | null;
  reason: string | null;
  batch_code: string | null;
  expires_at: string | null;
  order_id: string | null;
  operator_name: string | null;
  created_at: string;
  ingredient?: { name: string; unit: string };
};

export type StockCount = {
  id: string;
  tenant_id: string;
  ingredient_id: string;
  counted_qty: number;
  system_qty: number;
  difference: number;
  notes: string | null;
  operator_name: string | null;
  photo_url: string | null;
  created_at: string;
  ingredient?: { name: string; unit: string };
};

export const useStockMovements = (tenantId?: string, limit = 100) =>
  useQuery({
    queryKey: ["stock_movements", tenantId, limit],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("stock_movements")
        .select("*, ingredient:ingredients(name, unit)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as StockMovement[];
    },
  });

export const useAddStockMovement = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: Omit<Partial<StockMovement>, "id" | "created_at" | "tenant_id"> & { ingredient_id: string; type: StockMovement["type"]; quantity: number }) => {
      const { error } = await (supabase as any).from("stock_movements").insert({ ...m, tenant_id: tenantId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_movements", tenantId] });
      qc.invalidateQueries({ queryKey: ["ingredients", tenantId] });
      qc.invalidateQueries({ queryKey: ["ingredients_low_stock", tenantId] });
    },
  });
};

export const useStockCounts = (tenantId?: string) =>
  useQuery({
    queryKey: ["stock_counts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("stock_counts")
        .select("*, ingredient:ingredients(name, unit)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as StockCount[];
    },
  });

export const useAddStockCount = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: { ingredient_id: string; counted_qty: number; system_qty: number; notes?: string; operator_name?: string; photo_url?: string }) => {
      const { error } = await (supabase as any).from("stock_counts").insert({ ...c, tenant_id: tenantId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_counts", tenantId] });
      qc.invalidateQueries({ queryKey: ["ingredients", tenantId] });
      qc.invalidateQueries({ queryKey: ["stock_movements", tenantId] });
      qc.invalidateQueries({ queryKey: ["ingredients_low_stock", tenantId] });
    },
  });
};

export const useLowStock = (tenantId?: string) =>
  useQuery({
    queryKey: ["ingredients_low_stock", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ingredients_low_stock")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("shortage", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; unit: string; stock: number; stock_min: number; shortage: number; supplier: string | null }>;
    },
  });

export const useWasteReport = (tenantId?: string, fromIso?: string, toIso?: string) =>
  useQuery({
    queryKey: ["waste_report", tenantId, fromIso, toIso],
    enabled: !!tenantId && !!fromIso && !!toIso,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("stock_movements")
        .select("quantity, unit_cost, reason, created_at, ingredient:ingredients(name, unit, cost_per_unit)")
        .eq("tenant_id", tenantId)
        .eq("type", "perda")
        .gte("created_at", fromIso!)
        .lte("created_at", toIso!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
