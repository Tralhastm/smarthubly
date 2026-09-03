// Ficha técnica: ingredientes + receita por produto + CMV + DRE.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Ingredient = {
  id: string;
  tenant_id: string;
  name: string;
  unit: string;
  cost_per_unit: number;
  stock: number;
  stock_min: number;
  supplier: string | null;
  notes: string | null;
};

export type RecipeRow = {
  id: string;
  product_id: string;
  ingredient_id: string;
  quantity: number;
  ingredient?: Ingredient;
};

export const useIngredients = (tenantId?: string) => {
  return useQuery({
    queryKey: ["ingredients", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ingredients")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Ingredient[];
    },
  });
};

export const useSaveIngredient = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Ingredient> & { id?: string }) => {
      if (payload.id) {
        const { error } = await (supabase as any).from("ingredients").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("ingredients").insert({ ...payload, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ingredients", tenantId] }),
  });
};

export const useDeleteIngredient = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("ingredients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ingredients", tenantId] }),
  });
};

export const useProductRecipe = (productId?: string) => {
  return useQuery({
    queryKey: ["recipe", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_recipes")
        .select("*, ingredient:ingredients(*)")
        .eq("product_id", productId);
      if (error) throw error;
      return (data ?? []) as RecipeRow[];
    },
  });
};

export const useUpsertRecipeRow = (productId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { tenant_id: string; product_id: string; ingredient_id: string; quantity: number }) => {
      const { error } = await (supabase as any)
        .from("product_recipes")
        .upsert(row, { onConflict: "product_id,ingredient_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipe", productId] }),
  });
};

export const useDeleteRecipeRow = (productId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("product_recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipe", productId] }),
  });
};

export const useProductCMV = (productId?: string) => {
  return useQuery({
    queryKey: ["product-cmv", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("calc_product_cmv", { _product_id: productId });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
};

export type DreResult = {
  revenue: number;
  cmv: number;
  platform_fee: number;
  expenses: number;
  gross_profit: number;
  gross_margin_pct: number;
  net_profit: number;
};

export const useDRE = (tenantId?: string, from?: string, to?: string) => {
  return useQuery({
    queryKey: ["dre", tenantId, from, to],
    enabled: !!tenantId && !!from && !!to,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_dre", {
        _tenant_id: tenantId, _from: from, _to: to,
      });
      if (error) throw error;
      return data as DreResult;
    },
  });
};
