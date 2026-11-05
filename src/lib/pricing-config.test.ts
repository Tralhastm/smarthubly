import { describe, expect, it } from 'vitest';
import { calculateConfiguredFinalProfit } from './pricing';

describe('configured catalog pricing', () => {
  const config = {
    minimumProfit: 80,
    sellerSharePercent: 20,
    expenses: [
      { amountType: 'percentage' as const, amount: 5, enabled: true },
      { amountType: 'fixed' as const, amount: 60, enabled: true },
      { amountType: 'fixed' as const, amount: 999, enabled: false },
    ],
  };

  it('applies only active store expenses and seller commission', () => {
    const pricing = calculateConfiguredFinalProfit(1000, 700, config);
    expect(pricing.operatingProfit).toBe(190);
    expect(pricing.seller).toBe(38);
    expect(pricing.finalProfit).toBe(152);
    expect(pricing.belowMinimum).toBe(false);
  });

  it('blocks when the final profit is below the store minimum', () => {
    const pricing = calculateConfiguredFinalProfit(1000, 700, { ...config, minimumProfit: 200 });
    expect(pricing.finalProfit).toBe(152);
    expect(pricing.belowMinimum).toBe(true);
  });
});
