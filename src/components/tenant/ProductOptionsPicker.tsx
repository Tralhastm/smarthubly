import { useState, useEffect } from 'react';
import { useProductVariants, useProductAddons, type ProductVariant, type ProductAddon } from '@/hooks/useProductExtras';
import { useCart, type CartAddon } from '@/contexts/CartContext';
import type { Tables } from '@/integrations/supabase/types';
import { X, Plus, Minus, Check } from 'lucide-react';
import { hasPositiveFinalProfit, grossUpPaymentFee } from '@/lib/pricing';

type Product = Tables<'products'>;

interface Props {
  product: Product;
  showPixPrice?: boolean;
  onClose: () => void;
}

const ProductOptionsPicker = ({ product, showPixPrice = false, onClose }: Props) => {
  const { data: variants = [] } = useProductVariants(product.id);
  const { data: addons = [] } = useProductAddons(product.id);
  const { addToCart } = useCart();

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const productUnavailable = product.in_stock === false || (product.in_stock as any) === 'false';
  const displayPrice = (value: number) => showPixPrice ? grossUpPaymentFee(value, 0.99) : value;
  const availableVariants = variants.filter(v =>
    v.in_stock !== false && v.in_stock !== 'false' &&
    ((v as any).allow_loss || (product as any).allow_loss || hasPositiveFinalProfit(
      getVariantSalePrice({ productPrice: Number(product.price), productCost: (product as any).original_price, suggestedPrice: v.suggested_price, priceDelta: v.price_delta, variantCost: v.cost_price }),
      v.cost_price ?? (product as any).original_price,
    ))
  );

  // Auto-seleciona primeira variante disponível
  useEffect(() => {
    if (availableVariants.length > 0 && !selectedVariant) {
      const first = availableVariants[0];
      if (first) setSelectedVariant(first);
    }
  }, [availableVariants, selectedVariant, product]);

  const updateAddon = (id: string, delta: number, max: number) => {
    setAddonQty(prev => {
      const cur = prev[id] || 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      return { ...prev, [id]: next };
    });
  };

  // Validar adicionais obrigatórios
  const missingRequired = addons.filter(a => a.required && (addonQty[a.id] || 0) === 0);

  const cartAddons: CartAddon[] = addons
    .filter(a => (addonQty[a.id] || 0) > 0)
    .map(a => ({ id: a.id, name: a.name, price: a.price, quantity: addonQty[a.id] }));

  // suggested_price é o preço final absoluto da cor; só usamos a diferença
  // em relação ao preço base porque o carrinho soma esse campo ao produto.
  const selectedVariantPrice = selectedVariant
    ? getVariantSalePrice({ productPrice: Number(product.price), productCost: (product as any).original_price, suggestedPrice: selectedVariant.suggested_price, priceDelta: selectedVariant.price_delta, variantCost: selectedVariant.cost_price })
    : Number(product.price);
  const variantDelta = selectedVariant ? selectedVariantPrice - Number(product.price) : 0;
  const addonsTotal = cartAddons.reduce((s, a) => s + a.price * a.quantity, 0);
  const unitTotal = selectedVariantPrice + addonsTotal;

  const handleAdd = () => {
    if (productUnavailable || (variants.length > 0 && availableVariants.length === 0)) return;
    if (missingRequired.length > 0) return;
    addToCart(product, {
      variantId: selectedVariant?.id || null,
      variantName: selectedVariant?.name || null,
      variantSupplierId: selectedVariant?.supplier_id || null,
      variantPriceDelta: variantDelta,
      addons: cartAddons,
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="font-heading text-base text-foreground truncate">{product.name}</h3>
            <p className="text-xs text-muted-foreground">Personalize seu pedido{showPixPrice ? ' · preço no Pix' : ''}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Variantes */}
          {availableVariants.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">Cores disponíveis e preços</h4>
              <div className="space-y-1.5">
                {availableVariants.map(v => {
                  const variantPrice = getVariantSalePrice({ productPrice: Number(product.price), productCost: (product as any).original_price, suggestedPrice: v.suggested_price, priceDelta: v.price_delta, variantCost: v.cost_price });
                  return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariant(v)}
                    className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                      selectedVariant?.id === v.id
                        ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-secondary text-foreground hover:border-primary/40'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                        selectedVariant?.id === v.id ? 'border-primary bg-primary' : 'border-muted-foreground'
                      }`}>
                        {selectedVariant?.id === v.id && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </span>
                      <span>{v.name}</span>
                    </span>
                    <span className="text-xs font-medium text-primary">
                      R${displayPrice(variantPrice).toFixed(2)}
                    </span>
                  </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Adicionais */}
          {addons.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">
                Adicionais
                {addons.some(a => a.required) && <span className="text-[10px] text-destructive ml-2">* obrigatório</span>}
              </h4>
              <div className="space-y-1.5">
                {addons.map(a => {
                  const qty = addonQty[a.id] || 0;
                  const isMissing = a.required && qty === 0;
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                        isMissing ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-secondary'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground flex items-center gap-1">
                          {a.name}
                          {a.required && <span className="text-destructive">*</span>}
                        </p>
                        {a.price > 0 && (
                          <p className="text-xs text-primary">+R${a.price.toFixed(2)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => updateAddon(a.id, -1, a.max_quantity)}
                          disabled={qty === 0}
                          className="h-7 w-7 rounded-md bg-card border border-border text-foreground disabled:opacity-30 flex items-center justify-center hover:border-primary/40"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-sm font-medium text-foreground">{qty}</span>
                        <button
                          onClick={() => updateAddon(a.id, 1, a.max_quantity)}
                          disabled={qty >= a.max_quantity}
                          className="h-7 w-7 rounded-md bg-card border border-border text-foreground disabled:opacity-30 flex items-center justify-center hover:border-primary/40"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Observação */}
          <div>
            <label className="text-sm font-medium text-foreground block mb-1">Observação (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Ex: sem cebola, ponto da carne..."
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Footer com total + botão */}
        <div className="border-t border-border p-3 shrink-0 space-y-2">
          {missingRequired.length > 0 && (
            <p className="text-xs text-destructive">
              ⚠ Selecione: {missingRequired.map(m => m.name).join(', ')}
            </p>
          )}
          <button
            onClick={handleAdd}
            disabled={productUnavailable || (variants.length > 0 && availableVariants.length === 0) || missingRequired.length > 0}
            className="w-full flex items-center justify-between gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-3 font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{productUnavailable || (variants.length > 0 && availableVariants.length === 0) ? 'Indisponível' : 'Adicionar ao carrinho'}</span>
            <span className="font-bold">R${displayPrice(unitTotal).toFixed(2)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductOptionsPicker;
import { getVariantSalePrice } from '@/lib/variant-pricing';
