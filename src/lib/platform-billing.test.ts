import { describe, expect, it } from 'vitest';
import { shouldChargePerOrderPlatformFee } from './platform-billing';

describe('platform billing policy', () => {
  it('não cobra taxa por pedido quando Sociedade está ativa', () => {
    expect(shouldChargePerOrderPlatformFee({
      societyBillingEnabled: true,
      billingMode: 'per_order',
    })).toBe(false);
  });

  it('mantém a taxa por pedido para lojas no modelo padrão', () => {
    expect(shouldChargePerOrderPlatformFee({
      societyBillingEnabled: false,
      billingMode: 'per_order',
    })).toBe(true);
  });

  it('não cobra taxa por pedido em mensalidade fixa ou lojas doadas', () => {
    expect(shouldChargePerOrderPlatformFee({ billingMode: 'monthly_fixed' })).toBe(false);
    expect(shouldChargePerOrderPlatformFee({ isDonated: true })).toBe(false);
  });
});
