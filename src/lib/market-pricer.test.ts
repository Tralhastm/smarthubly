import { describe, expect, it } from 'vitest';
import { calculatePricing, MINIMUM_COMPARABLE_EVIDENCE, normalizeProductName, parseBrazilianNumber, parseSupplierText } from './market-pricer';

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

  it('ignora a classificação interna Grade A no nome do produto', () => {
    const rows = parseSupplierText('iPhone 13 256GB Grade A — R$ 1.950,00');
    expect(rows[0].name).toBe('iPhone 13 256GB');
    expect(normalizeProductName('iPhone 13 256GB Grade A')).toBe('iphone 13 256gb');
  });

  it('mantém custos separados quando o mesmo modelo tem cores diferentes', () => {
    const rows = parseSupplierText([
      'iPhone 15 128GB Azul — R$ 2.950,00',
      'iPhone 15 128GB Preto — R$ 3.020,00',
    ].join('\n'));
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.name.includes('Azul'))?.supplierCost).toBe(2950);
    expect(rows.find(row => row.name.includes('Preto'))?.supplierCost).toBe(3020);
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

  it('interpreta milhares sem ponto antes da vírgula no custo importado', () => {
    const rows = parseSupplierText('iPhone 15 128GB Novo — R$ 3000,00');
    expect(rows[0].supplierCost).toBe(3000);
    expect(rows[0].costWarning).toBeNull();
  });

  it('sinaliza custo suspeito abaixo de dez reais', () => {
    const rows = parseSupplierText('iPhone 14 128GB — 2,00');
    expect(rows[0].supplierCost).toBe(2);
    expect(rows[0].costWarning).toContain('Custo suspeito');
  });

  it('calcula preço mínimo com taxa e motoboy e identifica margem segura', () => {
    const result = calculatePricing(1400, [
      { label: 'Taxa', amountType: 'percentage', amount: 4.99, enabled: true },
      { label: 'Motoboy', amountType: 'fixed', amount: 50, enabled: true },
    ], 1800, 100, undefined, MINIMUM_COMPARABLE_EVIDENCE);
    expect(result.minimumPrice).toBeCloseTo(1631.41, 2);
    expect(result.marketRecommendedPrice).toBe(1800);
    expect(result.netProfit).toBeCloseTo(100, 2);
    expect(result.marketNetProfit).toBeCloseTo(260.18, 2);
    expect(result.marketMarginPercent).toBeCloseTo(14.45, 2);
    expect(result.decision).toBe('margem-segura');
  });

  it('não recomenda sem evidência de mercado', () => {
    const result = calculatePricing(1000, [], null, 100);
    expect(result.decision).toBe('inconclusivo');
    expect(result.netProfit).toBe(100);
    expect(result.marketRecommendedPrice).toBeNull();
    expect(result.marketNetProfit).toBeNull();
    expect(result.marketMarginPercent).toBeNull();
  });

  it('não aprova preço de mercado abaixo do mínimo viável', () => {
    const result = calculatePricing(1800, [], 1900, 300, undefined, MINIMUM_COMPARABLE_EVIDENCE);
    expect(result.minimumPrice).toBe(2100);
    expect(result.marketRecommendedPrice).toBeNull();
    expect(result.decision).toBe('margem-segura');
  });

  it('separa preço mínimo viável de preço recomendado compatível', () => {
    const result = calculatePricing(1800, [], 2600, 300, undefined, MINIMUM_COMPARABLE_EVIDENCE);
    expect(result.minimumPrice).toBe(2100);
    expect(result.marketRecommendedPrice).toBe(2600);
    expect(result.marketNetProfit).toBe(800);
    expect(result.marketMarginPercent).toBeCloseTo(30.77, 2);
    expect(result.decision).toBe('carro-chefe');
  });

  it('não aprova preço de mercado com menos de cinco anúncios ou qualidade suspeita', () => {
    const tooFew = calculatePricing(1800, [], 2600, 300, undefined, MINIMUM_COMPARABLE_EVIDENCE - 1);
    const suspect = calculatePricing(1800, [], 2600, 300, undefined, MINIMUM_COMPARABLE_EVIDENCE, 'suspect');
    expect(tooFew.marketRecommendedPrice).toBeNull();
    expect(tooFew.decision).toBe('inconclusivo');
    expect(suspect.marketRecommendedPrice).toBeNull();
    expect(suspect.decision).toBe('inconclusivo');
  });

  it('aplica gasto específico somente ao produto correspondente', () => {
    const result = calculatePricing(1000, [
      { label: 'Embalagem do iPhone', amountType: 'fixed', amount: 50, enabled: true, productId: 'iphone-1' },
      { label: 'Taxa geral', amountType: 'percentage', amount: 10, enabled: true, productId: null },
    ], null, 100, 'iphone-1');
    expect(result.fixedExpenses).toBe(50);
    expect(result.minimumPrice).toBeCloseTo(1277.78, 2);
  });
});
