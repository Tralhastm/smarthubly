// Catálogo touch: lista de categorias → produtos.
import { useMemo, useState } from "react";
import { useProducts } from "@/hooks/useProducts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, ShoppingCart } from "lucide-react";

interface Props {
  tenantId: string;
  cartCount: number;
  cartTotal: number;
  onBack: () => void;
  onAdd: (p: { id: string; name: string; price: number }) => void;
  onOpenCart: () => void;
  contextLabel: string;
}

export default function PdvCatalog({ tenantId, cartCount, cartTotal, onBack, onAdd, onOpenCart, contextLabel }: Props) {
  const { data: products = [], isLoading } = useProducts(tenantId);
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);

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
              onClick={() => onAdd({ id: p.id, name: p.name, price: Number(p.price) })}
              className="bg-card border rounded-xl p-2 text-left active:scale-95 transition-transform"
            >
              {p.image ? (
                <img src={p.image} alt={p.name} className="w-full h-20 object-cover rounded-lg mb-1.5" loading="lazy" />
              ) : (
                <div className="w-full h-20 bg-muted rounded-lg mb-1.5" />
              )}
              <div className="text-xs font-medium line-clamp-2 min-h-[2rem]">{p.name}</div>
              <div className="text-sm font-bold text-primary mt-0.5">
                R$ {Number(p.price).toFixed(2).replace(".", ",")}
              </div>
            </button>
          ))}
        </div>
      </div>

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
