export type VariantPricingInput = {
  productPrice: number;
  productCost?: number | null;
  suggestedPrice?: number | null;
  priceDelta?: number | null;
  variantCost?: number | null;
};

/**
 * Retorna o preço final de uma variante.
 *
 * Prioridade: preço explícito da cor ou diferença manual. Custo de fornecedor
 * nunca vira preço de revenda automaticamente; variações sem preço devem ser
 * sinalizadas no painel para definição manual.
 */
export function getVariantSalePrice(input: VariantPricingInput): number {
  const productPrice = Number(input.productPrice) || 0;
  const suggestedPrice = Number(input.suggestedPrice) || 0;
  const priceDelta = Number(input.priceDelta) || 0;
  if (suggestedPrice > 0) return suggestedPrice;
  if (priceDelta !== 0) return Math.max(0, productPrice + priceDelta);
  return Math.max(0, productPrice);
}
