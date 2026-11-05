import { describe, expect, it } from 'vitest';
import { extractSupplierImportColors, getCuratedSupplierProductAliases } from './supplier-catalog-matching';

describe('matching curado do catálogo do fornecedor', () => {
  it('reconhece Ocean sem perder Blue na mesma linha', () => {
    expect(extractSupplierImportColors('Blue e Ocean')).toEqual(['Azul', 'Ocean']);
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
