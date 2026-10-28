import { describe, expect, it } from 'vitest';
import { calculatePeriodFinance, isOrderRevenueEntry } from './finance-metrics';

describe('finance metrics', () => {
  it('calcula receita de pedidos + entradas manuais sem duplicar receita automática', () => {
    const result = calculatePeriodFinance({
      realizedOrders: [{ total: 100, platform_fee: 5 }],
      entries: [
        { type: 'income', amount: 100, description: 'Venda automática #ORDER_REVENUE:abc' },
        { type: 'income', amount: 30, description: 'Outra entrada' },
      ],
    });

    expect(isOrderRevenueEntry({ description: 'Venda #ORDER_REVENUE:abc' })).toBe(true);
    expect(result.income).toBe(130);
    expect(result.profit).toBe(125);
  });

  it('inclui todas as despesas no lucro, mesmo cartão ainda não pago', () => {
    const result = calculatePeriodFinance({
      realizedOrders: [{ total: 500, platform_fee: 10 }],
      entries: [
        { type: 'expense', amount: 100, description: 'Aluguel', paid: true },
        { type: 'expense', amount: 80, description: 'Compra no cartão', is_credit_card: true, paid: false },
      ],
    });

    expect(result.expenses).toBe(180);
    expect(result.profit).toBe(310);
    expect(result.cashOutflow).toBe(110);
    expect(result.pendingCard).toBe(80);
    expect(result.availableBalance).toBe(310);
  });

  it('não transforma fiado em receita realizada no contrato de cálculo', () => {
    const result = calculatePeriodFinance({
      realizedOrders: [],
      entries: [{ type: 'income', amount: 25, description: 'Pagamento de fiado quitado' }],
    });

    expect(result.income).toBe(25);
    expect(result.profit).toBe(25);
  });
});
