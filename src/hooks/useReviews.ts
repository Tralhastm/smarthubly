import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type Review = {
  id: string;
  order_id: string;
  tenant_id: string;
  supplier_id: string | null;
  rating: number;
  comment: string;
  created_at: string;
  updated_at: string;
};

export const useReviewByOrder = (orderId?: string) => {
  return useQuery({
    queryKey: ['review', orderId],
    queryFn: async (): Promise<Review | null> => {
      if (!orderId) return null;
      const { data } = await (supabase as any).from('order_reviews').select('*').eq('order_id', orderId).maybeSingle();
      return data as Review | null;
    },
    enabled: !!orderId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useTenantReviews = (tenantId?: string) => {
  return useQuery({
    queryKey: ['reviews', 'tenant', tenantId],
    queryFn: async (): Promise<Review[]> => {
      if (!tenantId) return [];
      const { data } = await (supabase as any).from('order_reviews').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      return (data as Review[]) || [];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useSupplierReviews = (supplierId?: string) => {
  return useQuery({
    queryKey: ['reviews', 'supplier', supplierId],
    queryFn: async (): Promise<Review[]> => {
      if (!supplierId) return [];
      const { data } = await (supabase as any).from('order_reviews').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false });
      return (data as Review[]) || [];
    },
    enabled: !!supplierId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useUpsertReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (review: { order_id: string; tenant_id: string; supplier_id: string | null; rating: number; comment: string }) => {
      const { data: existing } = await (supabase as any).from('order_reviews').select('id').eq('order_id', review.order_id).maybeSingle();
      if (existing) {
        const { error } = await (supabase as any).from('order_reviews').update({ rating: review.rating, comment: review.comment }).eq('order_id', review.order_id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('order_reviews').insert(review);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['review', vars.order_id] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
};

export const computeAverage = (reviews: Review[]) => {
  if (reviews.length === 0) return { avg: 0, count: 0 };
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  return { avg: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
};
