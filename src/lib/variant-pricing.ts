export type VariantPricingInput = {
  productPrice: number;
  productCost?: number | null;
  suggestedPrice?: number | null;
  priceDelta?: number | null;
  variantCost?: number | null;
};

/**
 * Retorna o preço final publicado de uma variação.
 *
 * O backend de catálogo usa `product.price + price_delta` como fonte de
 * verdade. `suggested_price` é um snapshot antigo do fornecedor e não pode
 * sobrescrever um reajuste automático da Margem Segura. Manter a mesma regra
 * aqui evita que vitrine, carrinho e painel administrativo exibam valores
 * diferentes do preço que será usado no checkout.
 */
export function getVariantSalePrice(input: VariantPricingInput): number {
  const productPrice = Number(input.productPrice) || 0;
  const priceDelta = Number(input.priceDelta) || 0;
  return Math.max(0, productPrice + priceDelta);
}

/** Mantém o mesmo tratamento de boolean e texto usado pelo seletor de variantes. */
export function isVariantInStock(value: unknown): boolean {
  return value !== false && String(value).toLowerCase() !== 'false';
}

/** Retorna o menor preço positivo entre variantes com estoque disponível. */
export function getLowestInStockVariantPrice(
  variants: Array<{ in_stock?: unknown; salePrice: unknown }>,
): number | null {
  const availablePrices = variants
    .filter(variant => isVariantInStock(variant.in_stock))
    .map(variant => Number(variant.salePrice))
    .filter(price => Number.isFinite(price) && price > 0);

  return availablePrices.length > 0 ? Math.min(...availablePrices) : null;
}
