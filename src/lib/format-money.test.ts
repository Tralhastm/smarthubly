import { describe, expect, it } from 'vitest';
import { formatBRL } from './format-money';

describe('formatBRL', () => {
  it('uses Brazilian grouping and decimal separators', () => {
    expect(formatBRL(1162.05)).toBe('R$\u00a01.162,05');
  });

  it('rounds to two decimal places', () => {
    expect(formatBRL(1063.056)).toBe('R$\u00a01.063,06');
  });

  it('formats numeric strings and safely handles invalid values', () => {
    expect(formatBRL('99.5')).toBe('R$\u00a099,50');
    expect(formatBRL(undefined)).toBe('R$\u00a00,00');
    expect(formatBRL('invalid')).toBe('R$\u00a00,00');
  });
});
