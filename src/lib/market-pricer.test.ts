import { describe, expect, it } from 'vitest';
import { calculatePricing, parseSupplierText } from './market-pricer';

describe('market pricer', () => {
  it('consolida produtos repetidos e preserva o custo', () => {
    const rows = parseSupplierText([
      'iPhone 15 128GB — R$ 2.950,00',
      'Moto G55 256GB — R$ 1.400,00',
      'iPhone 15 128GB — R$ 2.900,00',
      'iPhone 15 128GB — R$ 2.920,00',
    ].join('\n'));
    expect(rows[0].name).toContain('iPhone 15 128GB');
    expect(rows[0].occurrences).toBe(3);
    expect(rows[0].supplierCost).toBe(2950);
    expect(rows[1].occurrences).toBe(1);
  });

  it('não transforma memória em custo quando a linha não tem preço', () => {
    const rows = parseSupplierText('POCO X8 Pro 512GB');
    expect(rows[0].supplierCost).toBeNull();
  });

  it('calcula preço mínimo com taxa e motoboy e identifica carro-chefe', () => {
    const result = calculatePricing(1400, [
      { label: 'Taxa', amountType: 'percentage', amount: 4.99, enabled: true },
      { label: 'Motoboy', amountType: 'fixed', amount: 50, enabled: true },
    ], 1800, 100);
    expect(result.minimumPrice).toBeCloseTo(1631.41, 2);
    expect(result.netProfit).toBeCloseTo(100, 2);
    expect(result.decision).toBe('carro-chefe');
  });

  it('não recomenda sem evidência de mercado', () => {
    const result = calculatePricing(1000, [], null, 100);
    expect(result.decision).toBe('inconclusivo');
    expect(result.netProfit).toBe(100);
  });
});
