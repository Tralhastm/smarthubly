export const DEFAULT_ASAAS_RATE = 0.046;
export const DEFAULT_SHIPPING_COST = 50;
export const DEFAULT_CUSTOMER_DISCOUNT = 10;
export const DEFAULT_SELLER_SHARE = 0.20;

/** Calcula o lucro após checkout, frete, desconto e comissão do vendedor. */
export function calculateFinalProfit(salePrice: unknown, costPrice: unknown) {
  const sale = Number(salePrice) || 0;
  const cost = Number(costPrice) || 0;
  const asaas = sale * DEFAULT_ASAAS_RATE;
  const beforeSeller = sale - asaas - DEFAULT_SHIPPING_COST - DEFAULT_CUSTOMER_DISCOUNT - cost;
  const seller = Math.max(0, beforeSeller) * DEFAULT_SELLER_SHARE;
  const finalProfit = beforeSeller - seller;
  return { sale, cost, asaas, beforeSeller, seller, finalProfit, isLoss: finalProfit < 0 };
}

export function hasPositiveFinalProfit(salePrice: unknown, costPrice: unknown) {
  return calculateFinalProfit(salePrice, costPrice).finalProfit >= 0;
}

/** Gross-up em centavos: o preço exibido já inclui a taxa que será descontada. */
export function grossUpPaymentFee(price: unknown, feePercent: unknown) {
  const net = Math.max(0, Number(price) || 0);
  const fee = Math.max(0, Number(feePercent) || 0);
  if (net <= 0 || fee <= 0 || fee >= 100) return Math.round(net * 100) / 100;
  return Math.ceil((net / (1 - fee / 100)) * 100) / 100;
}
