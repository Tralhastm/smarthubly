// Política única de precificação do catálogo.
// O banco replica estes valores para que estoque, vitrine e pedido não diverjam.
export const DEFAULT_CHECKOUT_RATE = 0.0499;
export const DEFAULT_SHIPPING_COST = 50;
export const DEFAULT_CUSTOMER_DISCOUNT = 10;
export const DEFAULT_SELLER_SHARE = 0.20;
export const SAFE_MARGIN_THRESHOLD = 80;
export const SAFE_MARGIN_TARGET = 100;

export type CatalogPricingMode = 'margem_segura' | 'carro_chefe';

/** Lucro operacional antes do repasse do vendedor. */
export function calculateOperatingProfit(
  salePrice: unknown,
  costPrice: unknown,
  shippingCost = DEFAULT_SHIPPING_COST,
  discount = DEFAULT_CUSTOMER_DISCOUNT,
) {
  const sale = Number(salePrice) || 0;
  const cost = Number(costPrice) || 0;
  const checkoutFee = Math.max(0, sale) * DEFAULT_CHECKOUT_RATE;
  return sale - cost - checkoutFee - shippingCost - discount;
}

/** Resolve a fórmula inversa que deixa o lucro operacional no alvo após a taxa percentual. */
export function calculateSafeSalePrice(
  costPrice: unknown,
  shippingCost = DEFAULT_SHIPPING_COST,
  discount = DEFAULT_CUSTOMER_DISCOUNT,
  targetProfit = SAFE_MARGIN_TARGET,
) {
  const cost = Math.max(0, Number(costPrice) || 0);
  const raw = (cost + shippingCost + discount + targetProfit) / (1 - DEFAULT_CHECKOUT_RATE);
  return Math.ceil(raw * 100) / 100;
}

export function classifyCatalogPrice(
  salePrice: unknown,
  costPrice: unknown,
  shippingCost = DEFAULT_SHIPPING_COST,
  discount = DEFAULT_CUSTOMER_DISCOUNT,
): CatalogPricingMode {
  return calculateOperatingProfit(salePrice, costPrice, shippingCost, discount) < SAFE_MARGIN_THRESHOLD
    ? 'margem_segura'
    : 'carro_chefe';
}

/**
 * Calcula os valores financeiros finais de uma venda.
 * `operatingProfit` é o lucro usado para classificar o catálogo; `finalProfit`
 * é o lucro da loja depois do repasse de 20% ao vendedor.
 */
export function calculateFinalProfit(salePrice: unknown, costPrice: unknown) {
  const sale = Number(salePrice) || 0;
  const cost = Number(costPrice) || 0;
  const checkoutFee = Math.max(0, sale) * DEFAULT_CHECKOUT_RATE;
  const beforeSeller = sale - DEFAULT_CUSTOMER_DISCOUNT - checkoutFee - DEFAULT_SHIPPING_COST - cost;
  const operatingProfit = beforeSeller;
  const seller = Math.max(0, beforeSeller) * DEFAULT_SELLER_SHARE;
  const finalProfit = beforeSeller - seller;
  return {
    sale,
    cost,
    checkoutFee,
    beforeSeller,
    operatingProfit,
    seller,
    finalProfit,
    pricingMode: classifyCatalogPrice(sale, cost),
    safeSalePrice: calculateSafeSalePrice(cost),
    isLoss: finalProfit < 0,
  };
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
