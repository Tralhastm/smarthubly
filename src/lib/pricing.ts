export const DEFAULT_ASAAS_RATE = 0.046;
export const DEFAULT_SHIPPING_COST = 20;
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
