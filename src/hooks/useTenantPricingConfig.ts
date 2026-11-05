/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type TenantPricingExpense = {
  id?: string;
  label: string;
  amountType: 'percentage' | 'fixed';
  amount: number;
  enabled: boolean;
};

export type TenantPricingConfig = {
  minimumProfit: number;
  sellerSharePercent: number;
  expenses: TenantPricingExpense[];
};

const normalizeConfig = (value: any): TenantPricingConfig => ({
  minimumProfit: Math.max(0, Number(value?.minimumProfit ?? value?.minimum_profit ?? 0) || 0),
  sellerSharePercent: Math.min(100, Math.max(0, Number(value?.sellerSharePercent ?? value?.seller_share_percent ?? 0) || 0)),
  expenses: Array.isArray(value?.expenses)
    ? value.expenses.map((expense: any) => ({
        id: expense?.id ? String(expense.id) : undefined,
        label: String(expense?.label || '').trim(),
        amountType: expense?.amountType === 'percentage' || expense?.amount_type === 'percentage' ? 'percentage' : 'fixed',
        amount: Math.max(0, Number(expense?.amount) || 0),
        enabled: expense?.enabled !== false,
      })).filter((expense: TenantPricingExpense) => expense.label)
    : [],
});

export const useTenantPricingConfig = (tenantId?: string) => useQuery({
  queryKey: ['tenant-catalog-pricing-config', tenantId],
  enabled: !!tenantId,
  staleTime: 30_000,
  queryFn: async (): Promise<TenantPricingConfig> => {
    if (!tenantId) return normalizeConfig(null);
    const { data, error } = await supabase.rpc('get_catalog_pricing_config' as any, { _tenant_id: tenantId });
    if (error) throw error;
    return normalizeConfig(data);
  },
});
