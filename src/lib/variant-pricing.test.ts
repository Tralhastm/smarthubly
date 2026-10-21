import { describe, expect, it } from 'vitest';
import { getLowestInStockVariantPrice, isVariantInStock } from './variant-pricing';

describe('variant availability pricing', () => {
  it('accepts boolean and text stock flags consistently with the picker', () => {
    expect(isVariantInStock(true)).toBe(true);
    expect(isVariantInStock('true')).toBe(true);
    expect(isVariantInStock(false)).toBe(false);
    expect(isVariantInStock('false')).toBe(false);
    expect(isVariantInStock(undefined)).toBe(true);
  });

  it('ignores the cheapest unavailable variant when choosing the card minimum', () => {
    const motoG06Variants = [
      { salePrice: 999.9, in_stock: 'false' },
      { salePrice: 1069, in_stock: 'true' },
      { salePrice: 1069, in_stock: true },
    ];

    expect(getLowestInStockVariantPrice(motoG06Variants)).toBe(1069);
  });

  it('returns null when no positive-priced variant is in stock', () => {
    expect(getLowestInStockVariantPrice([
      { salePrice: 832.05, in_stock: false },
      { salePrice: 0, in_stock: true },
      { salePrice: Number.NaN, in_stock: true },
    ])).toBeNull();
  });
});
