import { describe, expect, it } from 'vitest';
import { extractSupplierImportColors, getCuratedSupplierProductAliases, isSupplierImportColorLine } from './supplier-catalog-matching';

describe('matching curado do catálogo do fornecedor', () => {
  it('reconhece Ocean sem perder Blue na mesma linha', () => {
    expect(extractSupplierImportColors('Blue e Ocean')).toEqual(['Azul', 'Ocean']);
  });

  it('reconhece uma linha independente com várias cores, conjunções, barras e emojis', () => {
    expect(isSupplierImportColorLine('Preto branco ⚪️🖤')).toBe(true);
    expect(extractSupplierImportColors('Preto branco ⚪️🖤')).toEqual(['Preto', 'Branco']);
    expect(isSupplierImportColorLine('Bordo / azul / preto 🍁')).toBe(true);
    expect(extractSupplierImportColors('Bordo / azul / preto 🍁')).toEqual(['Bordô', 'Azul', 'Preto']);
    expect(extractSupplierImportColors('Azul e roxo 🩵💜')).toEqual(['Azul', 'Roxo']);
    expect(extractSupplierImportColors('Silver ⚪️')).toEqual(['Prata']);
  });

  it('não confunde nome de produto ou preço com linha independente de cores', () => {
    expect(isSupplierImportColorLine('iPhone 17 Pro Max 256GB Preto')).toBe(false);
    expect(isSupplierImportColorLine('R$ 4.050')).toBe(false);
  });

  it('aplica o alias de Galaxy A07 somente à MANIA DIGITAL e ao cadastro exato', () => {
    expect(getCuratedSupplierProductAliases('MANIA DIGITAL', 'Samsung Galaxy A07 128GB/4GB'))
      .toEqual(['Galaxy A07 128GB']);
    expect(getCuratedSupplierProductAliases('HI PHONE', 'Samsung Galaxy A07 128GB/4GB')).toEqual([]);
    expect(getCuratedSupplierProductAliases('MANIA DIGITAL', 'Samsung Galaxy A07 5G 128GB/4GB')).toEqual([]);
  });

  it('mapeia a linha Note sem 5G somente ao Redmi Note 15 Pro 4G aprovado', () => {
    expect(getCuratedSupplierProductAliases(
      'MANIA DIGITAL',
      'Xiaomi Redmi Note 15 Pro 256GB/8GB (Versão 4G)',
    )).toEqual(['Note 15 Pro NFC 256/8GB']);
    expect(getCuratedSupplierProductAliases('MANIA DIGITAL', 'Redmi Note 15 Pro 512/12GB')).toEqual([]);
  });
});
