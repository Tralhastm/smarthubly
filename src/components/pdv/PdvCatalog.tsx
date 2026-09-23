// Catálogo touch: lista de categorias → produtos.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProducts } from "@/hooks/useProducts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, ShoppingCart, X } from "lucide-react";

interface Props {
  tenantId: string;
  cartCount: number;
  cartTotal: number;
  onBack: () => void;
  onAdd: (p: { id: string; variantId?: string; variantName?: string; name: string; price: number }) => void;
  onOpenCart: () => void;
  contextLabel: string;
}

export default function PdvCatalog({ tenantId, cartCount, cartTotal, onBack, onAdd, onOpenCart, contextLabel }: Props) {
  const { data: products = [], isLoading } = useProducts(tenantId);
  const { data: variants = [] } = useQuery({
    queryKey: ["pdv-product-variants", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants" as any)
        .select("id, product_id, name, price_delta, suggested_price, in_stock")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data || []) as { id: string; product_id: string; name: string; price_delta: number | null; suggested_price: number | null; in_stock: boolean | string }[];
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<(typeof products)[number] | null>(null);

  const availableVariants = (productId: string) => variants.filter(v =>
    v.product_id === productId && v.in_stock !== false && String(v.in_stock).toLowerCase() !== "false"
  );

  const displayPrice = (product: (typeof products)[number], variant?: (typeof variants)[number]) => {
    const basePrice = Number(product.price) || 0;
    if (variant) return Math.max(0, basePrice + (Number(variant.price_delta) || 0)) || Number(variant.suggested_price) || 0;
    if (basePrice > 0) return basePrice;
    const variantPrices = availableVariants(product.id)
      .map(v => displayPrice(product, v))
      .filter(price => price > 0);
    return variantPrices.length ? Math.min(...variantPrices) : 0;
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    let list = products.filter(p => p.in_stock !== false);
    if (activeCat) list = list.filter(p => p.category === activeCat);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, activeCat, search]);

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <header className="px-3 py-2 border-b flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vendendo em</div>
          <div className="text-sm font-semibold truncate">{contextLabel}</div>
        </div>
      </header>

      <div className="p-2 border-b">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar produto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-11"
          />
        </div>
      </div>

      {categories.length > 0 && (
        <div className="flex gap-1.5 px-2 py-2 overflow-x-auto border-b shrink-0">
          <Button
            size="sm"
            variant={activeCat === null ? "default" : "outline"}
            onClick={() => setActiveCat(null)}
            className="shrink-0 h-9"
          >Tudo</Button>
          {categories.map(c => (
            <Button
              key={c}
              size="sm"
              variant={activeCat === c ? "default" : "outline"}
              onClick={() => setActiveCat(c)}
              className="shrink-0 h-9"
            >{c}</Button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading && <div className="text-center py-10 text-muted-foreground">Carregando...</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">Nenhum produto encontrado</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => availableVariants(p.id).length > 0
                ? setSelectedProduct(p)
                : onAdd({ id: p.id, name: p.name, price: displayPrice(p) })}
              className="bg-card border rounded-xl p-2 text-left active:scale-95 transition-transform"
            >
              {p.image ? (
                <img src={p.image} alt={p.name} className="w-full h-20 object-cover rounded-lg mb-1.5" loading="lazy" />
              ) : (
                <div className="w-full h-20 bg-muted rounded-lg mb-1.5" />
              )}
              <div className="text-xs font-medium line-clamp-2 min-h-[2rem]">{p.name}</div>
              <div className="text-sm font-bold text-primary mt-0.5">
                R$ {displayPrice(p).toFixed(2).replace(".", ",")}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedProduct && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50" onClick={() => setSelectedProduct(null)}>
          <div className="w-full rounded-t-2xl border-t bg-card p-4 space-y-3" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Selecione a cor/variação</p>
                <h2 className="font-semibold text-foreground">{selectedProduct.name}</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedProduct(null)}><X className="h-5 w-5" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {availableVariants(selectedProduct.id).map(variant => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => {
                    onAdd({ id: selectedProduct.id, variantId: variant.id, variantName: variant.name, name: selectedProduct.name, price: displayPrice(selectedProduct, variant) });
                    setSelectedProduct(null);
                  }}
                  className="rounded-xl border border-border bg-background p-3 text-left hover:border-primary active:scale-[0.98]"
                >
                  <span className="block font-medium text-foreground">{variant.name}</span>
                  <span className="mt-1 block text-sm font-bold text-primary">R$ {displayPrice(selectedProduct, variant).toFixed(2).replace(".", ",")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {cartCount > 0 && (
        <button
          onClick={onOpenCart}
          className="bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between font-semibold active:scale-[0.98] transition-transform border-t-2 border-primary-foreground/20"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            {cartCount} {cartCount === 1 ? "item" : "itens"}
          </span>
          <span className="text-lg">R$ {cartTotal.toFixed(2).replace(".", ",")}</span>
        </button>
      )}
    </div>
  );
}
