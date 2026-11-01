import { describe, expect, it } from 'vitest';
import { evaluateShoppingResults } from '../../supabase/functions/market-price-research/market-research';

function listing(title: string, price: number, extras: Record<string, unknown> = {}) {
  return {
    title,
    extracted_price: price,
    source: 'Loja teste',
    product_link: `https://example.test/${encodeURIComponent(title)}-${price}`,
    condition: 'new',
    ...extras,
  };
}

describe('market research evidence quality', () => {
  it('requires five comparable new/sealed offers before approving a reference', () => {
    const result = evaluateShoppingResults('iPhone 14 256GB', [
      listing('Apple iPhone 14 256GB novo', 2600),
      listing('Apple iPhone 14 256GB lacrado', 2700),
      listing('Apple iPhone 14 256 GB novo', 2750),
      listing('Apple iPhone 14 256GB sealed', 2800),
    ], '2026-11-01T12:00:00.000Z');

    expect(result.found_count).toBe(4);
    expect(result.evidence_count).toBe(4);
    expect(result.quality_status).toBe('insufficient_evidence');
    expect(result.quality_note).toContain('4/5');
  });

  it('rejects a Pro model when the supplier list requests the standard iPhone', () => {
    const result = evaluateShoppingResults('iPhone 14 256GB', [
      listing('Apple iPhone 14 Pro 256GB novo', 3800),
    ]);

    expect(result.evidence_count).toBe(0);
    expect(result.sources[0].status).toBe('rejected');
    expect(result.sources[0].rejection_reason).toContain('variante');
  });

  it('does not confuse a 5G feature with a different model code, but still checks it when requested', () => {
    const unrequestedNetwork = evaluateShoppingResults('iPhone 14 256GB', [
      listing('Apple iPhone 14 256GB 5G novo', 2700),
    ]);
    const wrongRequestedNetwork = evaluateShoppingResults('Moto G35 256/4GB 5G', [
      listing('Motorola Moto G35 256GB/4GB 4G novo', 1000),
    ]);

    expect(unrequestedNetwork.sources[0].status).toBe('comparable');
    expect(wrongRequestedNetwork.sources[0].status).toBe('rejected');
    expect(wrongRequestedNetwork.sources[0].rejection_reason).toContain('5g');
  });

  it('rejects used or Grade A listings and listings without explicit new-condition evidence', () => {
    const result = evaluateShoppingResults('iPhone 14 256GB', [
      listing('Apple iPhone 14 256GB seminovo', 2400),
      listing('Apple iPhone 14 256GB Grade A', 2500),
      listing('Apple iPhone 14 256GB', 2600, { condition: undefined }),
    ]);

    expect(result.evidence_count).toBe(0);
    expect(result.sources.map(source => source.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(result.sources[2].rejection_reason).toContain('não está comprovada');
  });

  it('accepts an exact retail listing when Google Shopping omits condition', () => {
    const result = evaluateShoppingResults('iPhone 15 128GB', [
      listing('Smartphone Apple iPhone 15 128GB Preto - 5G + Carregador USB-C', 4157.99, {
        source: 'Magalu',
        condition: undefined,
      }),
    ]);

    expect(result.sources[0].status).toBe('comparable');
    expect(result.sources[0].condition).toBe('new');
  });

  it('does not treat a charger wattage as an extra product variant', () => {
    const result = evaluateShoppingResults('iPhone 16 128GB', [
      listing('Smartphone Apple iPhone 16 128GB Preto - 5G + Carregador Apple USB-C 20W Original', 4958.99, {
        source: 'Magalu',
        condition: undefined,
      }),
    ]);

    expect(result.sources[0].status).toBe('comparable');
  });

  it('requires the supplier color and rejects a different listed color', () => {
    const result = evaluateShoppingResults('iPhone 14 256GB Azul', [
      listing('Apple iPhone 14 256GB Blue novo', 2700),
      listing('Apple iPhone 14 256GB Preto lacrado', 2600),
    ]);

    expect(result.sources[0].status).toBe('comparable');
    expect(result.sources[1].status).toBe('rejected');
    expect(result.sources[1].rejection_reason).toContain('cor');
  });

  it('matches 128/4+4GB with 128GB/4GB without mixing a different storage/RAM combination', () => {
    const result = evaluateShoppingResults('Redmi 15C 128/4+4GB NFC', [
      listing('Xiaomi Redmi 15C NFC 128GB/4GB lacrado', 820),
      listing('Xiaomi Redmi 15C NFC 256GB/4GB lacrado', 920),
    ]);

    expect(result.sources[0].status).toBe('comparable');
    expect(result.sources[1].status).toBe('rejected');
    expect(result.sources[1].rejection_reason).toContain('capacidade');
  });

  it('excludes an extreme price with an audit reason and refuses approval if fewer than five remain', () => {
    const result = evaluateShoppingResults('iPhone 14 256GB', [
      listing('Apple iPhone 14 256GB novo', 2600),
      listing('Apple iPhone 14 256GB novo', 2700),
      listing('Apple iPhone 14 256GB novo', 2750),
      listing('Apple iPhone 14 256GB novo', 2800),
      listing('Apple iPhone 14 256GB novo', 4292.10),
    ]);

    expect(result.found_count).toBe(5);
    expect(result.evidence_count).toBe(4);
    expect(result.rejected_count).toBe(1);
    expect(result.sources.find(source => source.price === 4292.10)?.rejection_reason).toContain('Preço atípico');
    expect(result.quality_status).toBe('insufficient_evidence');
  });

  it('marks a wide but internally valid market spread as suspect', () => {
    const result = evaluateShoppingResults('iPhone 14 256GB', [
      listing('Apple iPhone 14 256GB novo', 2500),
      listing('Apple iPhone 14 256GB novo', 3000),
      listing('Apple iPhone 14 256GB novo', 3500),
      listing('Apple iPhone 14 256GB novo', 4000),
      listing('Apple iPhone 14 256GB novo', 4500),
    ]);

    expect(result.evidence_count).toBe(5);
    expect(result.quality_status).toBe('suspect');
    expect(result.quality_note).toContain('dispersão central');
  });

  it('approves a stable reference from five exact, new listings', () => {
    const result = evaluateShoppingResults('iPhone 14 256GB', [
      listing('Apple iPhone 14 256GB novo', 2600),
      listing('Apple iPhone 14 256GB novo', 2700),
      listing('Apple iPhone 14 256GB novo', 2750),
      listing('Apple iPhone 14 256GB novo', 2800),
      listing('Apple iPhone 14 256GB novo', 2850),
    ]);

    expect(result.evidence_count).toBe(5);
    expect(result.quality_status).toBe('approved');
    expect(result.median).toBe(2750);
    expect(result.min).toBe(2600);
    expect(result.max).toBe(2850);
  });
});
