import { describe, it, expect } from 'vitest';
import { estimateFreight } from './freight-viacep';

describe('estimateFreight (ViaCEP)', () => {
  it('mesma cidade (BH→BH) retorna taxa fixa baixa', async () => {
    const est = await estimateFreight('30130-100', '31846-320');
    expect(est).not.toBeNull();
    expect(est!.sameCity).toBe(true);
    expect(est!.pac).toBe(15);
    expect(est!.sedex).toBe(22);
  }, 15000);

  it('estados distintos (BH→SP) calcula por distância', async () => {
    const est = await estimateFreight('31846-320', '01310-100');
    expect(est).not.toBeNull();
    expect(est!.sameCity).toBe(false);
    expect(est!.distanceKm).toBeGreaterThan(300);
    expect(est!.pac).toBeGreaterThan(15);
    expect(est!.sedex).toBeGreaterThan(est!.pac);
  }, 15000);

  it('CEP inválido retorna null', async () => {
    const est = await estimateFreight('00000-000', '31846-320');
    expect(est).toBeNull();
  }, 15000);
});
