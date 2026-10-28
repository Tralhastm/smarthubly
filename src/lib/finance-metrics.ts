export type FinanceEntryLike = {
  type?: string | null;
  amount?: number | string | null;
  description?: string | null;
  is_credit_card?: boolean | null;
  paid?: boolean | null;
};

export type FinanceOrderLike = {
  total?: number | string | null;
  platform_fee?: number | string | null;
};

const amount = (value: number | string | null | undefined) => Number(value || 0);

export const isOrderRevenueEntry = (entry: FinanceEntryLike) =>
  Boolean(entry.description?.includes('#ORDER_REVENUE:'));

export const isPendingCardExpense = (entry: FinanceEntryLike) =>
  entry.type === 'expense' && entry.is_credit_card === true && entry.paid === false;

export function calculatePeriodFinance(input: {
  realizedOrders: FinanceOrderLike[];
  entries: FinanceEntryLike[];
}) {
  const orderRevenue = input.realizedOrders.reduce((sum, order) => sum + amount(order.total), 0);
  const orderFees = input.realizedOrders.reduce((sum, order) => sum + amount(order.platform_fee), 0);
  const manualIncome = input.entries
    .filter(entry => entry.type === 'income' && !isOrderRevenueEntry(entry))
    .reduce((sum, entry) => sum + amount(entry.amount), 0);
  const expenses = input.entries
    .filter(entry => entry.type === 'expense')
    .reduce((sum, entry) => sum + amount(entry.amount), 0);
  const paidExpenses = input.entries
    .filter(entry => entry.type === 'expense' && !isPendingCardExpense(entry))
    .reduce((sum, entry) => sum + amount(entry.amount), 0);
  const pendingCard = input.entries
    .filter(isPendingCardExpense)
    .reduce((sum, entry) => sum + amount(entry.amount), 0);
  const income = orderRevenue + manualIncome;

  return {
    income,
    expenses,
    paidExpenses,
    pendingCard,
    platformFees: orderFees,
    profit: income - orderFees - expenses,
    cashOutflow: orderFees + paidExpenses,
    accountBalance: income - orderFees - paidExpenses,
    availableBalance: income - orderFees - paidExpenses - pendingCard,
  };
}
