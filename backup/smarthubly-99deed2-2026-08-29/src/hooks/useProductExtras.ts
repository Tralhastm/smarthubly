import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ProductVariant = {
  id: string;
  product_id: string;
  tenant_id: string;
  name: string;
  price_delta: number;
  in_stock: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ProductAddon = {
  id: string;
  product_id: string;
  tenant_id: string;
  name: string;
  price: number;
  required: boolean;
  max_quantity: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const useProductVariants = (productId?: string) => {
  return useQuery({
    queryKey: ['product-variants', productId],
    queryFn: async () => {
      if (!productId) return [];
      const { data, error } = await supabase
        .from('product_variants' as any)
        .select('*')
        .eq('product_id', productId)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as unknown as ProductVariant[];
    },
    enabled: !!productId,
    staleTime: 30000,
  });
};

export const useProductAddons = (productId?: string) => {
  return useQuery({
    queryKey: ['product-addons', productId],
    queryFn: async () => {
      if (!productId) return [];
      const { data, error } = await supabase
        .from('product_addons' as any)
        .select('*')
        .eq('product_id', productId)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as unknown as ProductAddon[];
    },
    enabled: !!productId,
    staleTime: 30000,
  });
};

export const useSaveVariant = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: Partial<ProductVariant> & { product_id: string; tenant_id: string; name: string }) => {
      if (v.id) {
        const { error } = await supabase.from('product_variants' as any).update({
          name: v.name,
          price_delta: v.price_delta ?? 0,
          in_stock: v.in_stock ?? true,
          sort_order: v.sort_order ?? 0,
        }).eq('id', v.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('product_variants' as any).insert({
          product_id: v.product_id,
          tenant_id: v.tenant_id,
          name: v.name,
          price_delta: v.price_delta ?? 0,
          in_stock: v.in_stock ?? true,
          sort_order: v.sort_order ?? 0,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['product-variants', vars.product_id] }),
  });
};

export const useDeleteVariant = (productId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('product_variants' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-variants', productId] }),
  });
};

export const useSaveAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: Partial<ProductAddon> & { product_id: string; tenant_id: string; name: string }) => {
      if (a.id) {
        const { error } = await supabase.from('product_addons' as any).update({
          name: a.name,
          price: a.price ?? 0,
          required: a.required ?? false,
          max_quantity: a.max_quantity ?? 1,
          sort_order: a.sort_order ?? 0,
        }).eq('id', a.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('product_addons' as any).insert({
          product_id: a.product_id,
          tenant_id: a.tenant_id,
          name: a.name,
          price: a.price ?? 0,
          required: a.required ?? false,
          max_quantity: a.max_quantity ?? 1,
          sort_order: a.sort_order ?? 0,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['product-addons', vars.product_id] }),
  });
};

export const useDeleteAddon = (productId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('product_addons' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-addons', productId] }),
  });
};
