import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import { triggerSync } from '@/hooks/useIntegration';

export type Product = Tables<'products'>;

const PAGE_SIZE = 200;

export const useProducts = (tenantId?: string) => {
  return useQuery({
    queryKey: ['products', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase.from('products').select('*').eq('tenant_id', tenantId).order('created_at');
      if (error) throw error;
      // Defensive: if any image is a giant base64 (> 100KB), drop it from the payload to keep UI fast.
      // The real fix is migrating to storage, but this prevents repeated download of multi-MB rows.
      const cleaned = (data as Product[]).map((p) => {
        const img = (p as any).image as string | null;
        if (img && img.startsWith('data:') && img.length > 100_000) {
          return { ...p, image: '' } as Product;
        }
        return p;
      });
      return cleaned;
    },
    enabled: !!tenantId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
};

export const useInfiniteProducts = (tenantId?: string) => {
  return useInfiniteQuery({
    queryKey: ['products-infinite', tenantId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!tenantId) return { data: [] as Product[], nextPage: null };
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at')
        .range(from, to);
      if (error) throw error;
      return {
        data: data as Product[],
        nextPage: data.length === PAGE_SIZE ? pageParam + 1 : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    enabled: !!tenantId,
  });
};

export const useAddProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (product: Omit<TablesInsert<'products'>, 'id'>) => {
      const { data, error } = await supabase.from('products').insert(product).select().single();
      if (error) throw error;
      if (product.tenant_id) triggerSync(product.tenant_id, 'product_upsert', data);
      return data;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['products', vars.tenant_id] }),
  });
};

export const useUpdateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (product: Product) => {
      const { error } = await supabase.from('products').update({
        name: product.name,
        price: product.price,
        original_price: (product as any).original_price ?? 0,
        image: product.image,
        media: (product as any).media ?? [],
        category: product.category,
        description: product.description,
        in_stock: product.in_stock,
        supplier_id: product.supplier_id,
        platform_fee_percent: (product as any).platform_fee_percent ?? null,
        has_shipping: (product as any).has_shipping ?? false,
        shipping_fee_override: (product as any).shipping_fee_override ?? null,
        shipping_origin_override: (product as any).shipping_origin_override ?? null,
        stock_quantity: (product as any).stock_quantity ?? null,
        affiliate_url: (product as any).affiliate_url ?? null,
        affiliate_network: (product as any).affiliate_network ?? null,
        affiliate_coupon_code: (product as any).affiliate_coupon_code ?? null,
        affiliate_coupon_discount_price: (product as any).affiliate_coupon_discount_price ?? null,
        affiliate_coupon_expires_at: (product as any).affiliate_coupon_expires_at ?? null,
        item_type: (product as any).item_type ?? 'product',
        duration_minutes: (product as any).duration_minutes ?? null,
      } as any).eq('id', product.id);
      if (error) throw error;
      if (product.tenant_id) triggerSync(product.tenant_id, 'product_upsert', product);
      return product;
    },
    onSuccess: (product) => qc.invalidateQueries({ queryKey: ['products', product.tenant_id] }),
  });
};

export const useDeleteProduct = (tenantId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', tenantId] }),
  });
};
