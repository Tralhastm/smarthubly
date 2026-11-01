import { describe, expect, it } from 'vitest';
import { calculatePricing, parseBrazilianNumber, parseSupplierText } from './market-pricer';

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

  it('interpreta corretamente milhares no padrão brasileiro', () => {
    expect(parseBrazilianNumber('1.800,00')).toBe(1800);
    expect(parseBrazilianNumber('2.000,00')).toBe(2000);
    expect(parseBrazilianNumber('5.290')).toBe(5290);
    expect(parseBrazilianNumber('770,00')).toBe(770);
    expect(parseBrazilianNumber('1.950,00')).toBe(1950);
    expect(parseBrazilianNumber('5,29')).toBe(5.29);
  });

  it('sinaliza custo suspeito abaixo de dez reais', () => {
    const rows = parseSupplierText('iPhone 14 128GB — 2,00');
    expect(rows[0].supplierCost).toBe(2);
    expect(rows[0].costWarning).toContain('Custo suspeito');
  });

  it('calcula preço mínimo com taxa e motoboy e identifica carro-chefe', () => {
    const result = calculatePricing(1400, [
      { label: 'Taxa', amountType: 'percentage', amount: 4.99, enabled: true },
      { label: 'Motoboy', amountType: 'fixed', amount: 50, enabled: true },
    ], 1800, 100, undefined, 3);
    expect(result.minimumPrice).toBeCloseTo(1631.41, 2);
    expect(result.marketRecommendedPrice).toBe(1800);
    expect(result.netProfit).toBeCloseTo(100, 2);
    expect(result.decision).toBe('carro-chefe');
  });

  it('não recomenda sem evidência de mercado', () => {
    const result = calculatePricing(1000, [], null, 100);
    expect(result.decision).toBe('inconclusivo');
    expect(result.netProfit).toBe(100);
    expect(result.marketRecommendedPrice).toBeNull();
  });

  it('não aprova preço de mercado abaixo do mínimo viável', () => {
    const result = calculatePricing(1800, [], 1900, 300, undefined, 3);
    expect(result.minimumPrice).toBe(2100);
    expect(result.marketRecommendedPrice).toBeNull();
    expect(result.decision).toBe('inconclusivo');
  });

  it('separa preço mínimo viável de preço recomendado compatível', () => {
    const result = calculatePricing(1800, [], 2500, 300, undefined, 3);
    expect(result.minimumPrice).toBe(2100);
    expect(result.marketRecommendedPrice).toBe(2500);
    expect(result.decision).toBe('carro-chefe');
  });
});
