import { describe, expect, it } from 'vitest';
import { formatPublicStoreCatalog } from '../../supabase/functions/ai-chat-unified/_shared/store_catalog_context';

describe('formatPublicStoreCatalog', () => {
  it('uses the live storefront sale price for each in-stock variant', () => {
    const result = formatPublicStoreCatalog(
      [{ id: 'p1', name: 'Telefone', price: 1000, in_stock: true, store_visible: true }],
      [
        { product_id: 'p1', name: 'Azul', in_stock: 'true', price_delta: 75 },
        { product_id: 'p1', name: 'Preto', in_stock: 'false', price_delta: 0 },
      ],
    );

    expect(result.text).toContain('preço de venda a partir de R$ 1.075,00');
    expect(result.text).toContain('Azul — R$ 1.075,00');
    expect(result.text).not.toContain('Preto');
  });

  it('excludes hidden products and products whose variants are all unavailable', () => {
    const result = formatPublicStoreCatalog(
      [
        { id: 'hidden', name: 'Oculto', price: 80, in_stock: true, store_visible: false },
        { id: 'sold-out', name: 'Sem opção', price: 90, in_stock: true, store_visible: true },
      ],
      [{ product_id: 'sold-out', name: 'Azul', in_stock: 'false', price_delta: 5 }],
    );

    expect(result.products).toEqual([]);
    expect(result.text).not.toContain('Oculto');
    expect(result.text).not.toContain('Sem opção');
  });

  it('uses the base sale price for products without variants and never exposes original_price', () => {
    const result = formatPublicStoreCatalog(
      [{ id: 'p2', name: 'Serviço', price: 120, original_price: 60, in_stock: true, store_visible: true } as any],
      [],
    );

    expect(result.text).toContain('preço de venda R$ 120,00');
    expect(result.text).not.toContain('R$ 60,00');
  });
});
