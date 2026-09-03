import type { ProductVariant } from '@/hooks/useProductExtras';

interface ProductLike {
  price: number;
}

interface ProductColorPricingProps {
  product: ProductLike;
  variants?: ProductVariant[];
  className?: string;
  compact?: boolean;
}

const money = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `R$${Number(value).toFixed(2)}`;
};

const resaleFor = (product: ProductLike, variant: ProductVariant) =>
  Number(variant.suggested_price ?? (Number(product.price) + Number(variant.price_delta || 0)));

/** Mostra as variantes exatamente como foram atualizadas pela lista diária. */
const ProductColorPricing = ({ product, variants = [], className = '', compact = false }: ProductColorPricingProps) => {
  if (variants.length === 0) return null;

  return (
    <div className={`mt-3 rounded-lg border border-border/70 bg-secondary/30 p-3 ${className}`}>
      <p className="text-xs font-semibold text-foreground mb-2">Preço por cor</p>
      <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
        {variants.map(variant => (
          <div key={variant.id} className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground capitalize">{variant.name}</span>
              {!variant.in_stock && <span className="text-[10px] text-destructive">Esgotado</span>}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <span>Custo: <strong className="font-semibold text-foreground">{money(variant.cost_price)}</strong></span>
              <span>Revenda: <strong className="font-semibold text-primary">{money(resaleFor(product, variant))}</strong></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductColorPricing;
