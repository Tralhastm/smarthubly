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
 * Prioridade: preço explícito da cor, diferença manual e, por último,
 * atualização proporcional baseada no custo da cor. Isso faz o preço variar
 * automaticamente quando o fornecedor atualiza apenas o custo por cor,
 * preservando preços definidos manualmente.
 */
export function getVariantSalePrice(input: VariantPricingInput): number {
  const productPrice = Number(input.productPrice) || 0;
  const suggestedPrice = Number(input.suggestedPrice) || 0;
  const priceDelta = Number(input.priceDelta) || 0;
  const productCost = Number(input.productCost) || 0;
  const variantCost = Number(input.variantCost) || 0;

  if (suggestedPrice > 0) return suggestedPrice;
  if (priceDelta !== 0) return Math.max(0, productPrice + priceDelta);

  if (productPrice > 0 && productCost > 0 && variantCost > 0) {
    return Math.max(0, Math.round((productPrice * (variantCost / productCost)) * 100) / 100);
  }

  return Math.max(0, productPrice);
}
