import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type Coupon = {
  id: string;
  tenant_id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  min_order_value: number;
  max_uses: number | null;
  uses_count: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  seller_id?: string | null;
  seller_code_id?: string | null;
  seller_commission_percent?: number | null;
};

export const useCoupons = (tenantId?: string) => {
  return useQuery({
    queryKey: ['coupons', tenantId],
    queryFn: async (): Promise<Coupon[]> => {
      if (!tenantId) return [];
      const { data } = await (supabase as any).from('coupons').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      return (data as Coupon[]) || [];
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useUpsertCoupon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (coupon: Partial<Coupon> & { tenant_id: string; code: string }) => {
      if (coupon.id) {
        const { error } = await (supabase as any).from('coupons').update(coupon).eq('id', coupon.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('coupons').insert(coupon);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['coupons', vars.tenant_id] }),
  });
};

export const useDeleteCoupon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('coupons').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });
};

/**
 * Validate coupon by code for a given tenant + order subtotal.
 * Returns discount amount (0 if invalid) and reason string.
 */
export const validateCoupon = async (tenantId: string, code: string, subtotal: number): Promise<{ valid: boolean; discount: number; reason?: string; coupon?: Coupon }> => {
  const upper = code.trim().toUpperCase();
  if (!upper) return { valid: false, discount: 0, reason: 'Informe um código' };
  const { data } = await (supabase as any).from('coupons').select('*').eq('tenant_id', tenantId).ilike('code', upper).maybeSingle();
  const coupon = data as Coupon | null;
  if (!coupon) {
    const { data: sellerCode } = await (supabase as any).from('seller_codes_public').select('*').eq('tenant_id', tenantId).ilike('code', upper).maybeSingle();
    if (!sellerCode) return { valid: false, discount: 0, reason: 'Cupom não encontrado' };
    const sellerCoupon: Coupon = { ...sellerCode, tenant_id: tenantId, min_order_value: 0, expires_at: sellerCode.expires_at, created_at: '', updated_at: '', seller_id: sellerCode.seller_id, seller_code_id: sellerCode.id };
    return validateCouponResult(sellerCoupon, subtotal);
  }
  return validateCouponResult(coupon, subtotal);
};

const validateCouponResult = (coupon: Coupon, subtotal: number): { valid: boolean; discount: number; reason?: string; coupon?: Coupon } => {
  if (!coupon.active) return { valid: false, discount: 0, reason: 'Cupom desativado' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { valid: false, discount: 0, reason: 'Cupom expirado' };
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) return { valid: false, discount: 0, reason: 'Cupom esgotado' };
  if (subtotal < coupon.min_order_value) return { valid: false, discount: 0, reason: `Pedido mínimo R$${coupon.min_order_value.toFixed(2)}` };
  const discount = coupon.discount_type === 'percent'
    ? Math.min(subtotal * coupon.discount_value / 100, subtotal)
    : Math.min(coupon.discount_value, subtotal);
  return { valid: true, discount: Math.round(discount * 100) / 100, coupon };
};

export const incrementCouponUse = async (couponId: string, currentUses: number) => {
  await (supabase as any).from('coupons').update({ uses_count: currentUses + 1 }).eq('id', couponId);
};

export const incrementSellerCodeUse = async (codeId: string, currentUses: number) => {
  // O checkout pode ser anônimo; o RPC valida ativo, validade e limite no banco.
  await (supabase as any).rpc('increment_seller_code_use', { _code_id: codeId });
};
