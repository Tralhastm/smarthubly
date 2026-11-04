type StoreProduct = {
  id: string;
  name: string;
  price: number | string | null;
  category?: string | null;
  subcategory?: string | null;
  description?: string | null;
  in_stock?: unknown;
  store_visible?: unknown;
  item_type?: string | null;
  duration_minutes?: number | string | null;
  stock_quantity?: number | string | null;
};

type StoreVariant = {
  product_id: string;
  name?: string | null;
  in_stock?: unknown;
  price_delta?: number | string | null;
};

const isAvailable = (value: unknown) => value !== false && String(value).toLowerCase() !== "false";
const money = (value: number) => `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Formats only public, in-stock products and exact prices used by the storefront. */
export function formatPublicStoreCatalog(products: StoreProduct[], variants: StoreVariant[]) {
  const variantsByProduct = new Map<string, StoreVariant[]>();
  for (const variant of variants) {
    const list = variantsByProduct.get(variant.product_id) || [];
    list.push(variant);
    variantsByProduct.set(variant.product_id, list);
  }

  const availableProducts = products
    .filter(product => product.store_visible !== false && isAvailable(product.in_stock))
    .map(product => {
      const productVariants = variantsByProduct.get(product.id) || [];
      const availableVariants = productVariants
        .filter(variant => isAvailable(variant.in_stock) && Boolean(String(variant.name || "").trim()))
        .map(variant => ({
          name: String(variant.name).trim(),
          salePrice: Math.max(0, (Number(product.price) || 0) + (Number(variant.price_delta) || 0)),
        }))
        .filter(variant => Number.isFinite(variant.salePrice) && variant.salePrice > 0);
      return { product, hasVariants: productVariants.length > 0, availableVariants };
    })
    // A product with variants is only recommended when at least one exact, in-stock option exists.
    .filter(entry => !entry.hasVariants || entry.availableVariants.length > 0);

  const lines = availableProducts.map(({ product, hasVariants, availableVariants }) => {
    const category = [product.category, product.subcategory].filter(Boolean).join(" › ");
    const type = product.item_type === "service" ? ` | SERVIÇO (~${product.duration_minutes || 30} min)` : "";
    const stockQuantity = Number(product.stock_quantity);
    const stock = Number.isFinite(stockQuantity) && stockQuantity > 0 && stockQuantity <= 5
      ? ` | últimas ${stockQuantity} un`
      : "";
    const description = product.description ? ` | ${String(product.description).slice(0, 120)}` : "";
    const price = hasVariants
      ? `a partir de ${money(Math.min(...availableVariants.map(variant => variant.salePrice)))}`
      : money(Number(product.price) || 0);
    const variantText = hasVariants
      ? ` | variantes disponíveis: ${availableVariants.map(variant => `${variant.name} — ${money(variant.salePrice)}`).join("; ")}`
      : "";
    return `- ${product.name} | preço de venda ${price}${category ? ` | ${category}` : ""}${type}${stock}${variantText}${description}`;
  });

  const text = lines.length
    ? `\n\nPRODUTOS DISPONÍVEIS NA VITRINE (preços de venda atuais consultados no banco; use nomes e preços exatos):\n${lines.join("\n")}`
    : "\n\nCATÁLOGO SEM PRODUTOS VISÍVEIS E DISPONÍVEIS NO MOMENTO.";

  return { products: availableProducts.map(entry => entry.product), text };
}
