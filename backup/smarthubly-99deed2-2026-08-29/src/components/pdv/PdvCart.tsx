// Carrinho: lista de itens com +/-, total, finalizar.
import type { PdvCartItem } from "@/hooks/usePdvSession";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Minus, Plus, Trash2 } from "lucide-react";

interface Props {
  items: PdvCartItem[];
  total: number;
  contextLabel: string;
  modeIsTable: boolean;
  onBack: () => void;
  onInc: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
  onSaveTable?: () => void;
}

export default function PdvCart({ items, total, contextLabel, modeIsTable, onBack, onInc, onRemove, onCheckout, onSaveTable }: Props) {
  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <header className="px-3 py-2 border-b flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <div className="text-[10px] uppercase text-muted-foreground">Carrinho</div>
          <div className="text-sm font-semibold truncate">{contextLabel}</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">Carrinho vazio</div>
        )}
        {items.map(it => (
          <div key={it.productId} className="border rounded-xl p-3 bg-card">
            <div className="flex justify-between items-start gap-2 mb-2">
              <div className="font-medium text-sm flex-1">{it.name}</div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onRemove(it.productId)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => onInc(it.productId, -1)}>
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="font-bold text-lg w-7 text-center">{it.quantity}</span>
                <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => onInc(it.productId, 1)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">R$ {it.price.toFixed(2)} cada</div>
                <div className="font-bold">R$ {(it.price * it.quantity).toFixed(2).replace(".", ",")}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t bg-card p-3 space-y-2">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-2xl font-bold">R$ {total.toFixed(2).replace(".", ",")}</span>
        </div>
        {modeIsTable && onSaveTable && (
          <Button variant="outline" className="w-full h-12" onClick={onSaveTable} disabled={items.length === 0}>
            Salvar na mesa (continuar depois)
          </Button>
        )}
        <Button className="w-full h-14 text-base font-semibold" onClick={onCheckout} disabled={items.length === 0}>
          {modeIsTable ? "Fechar conta" : "Finalizar venda"}
        </Button>
      </div>
    </div>
  );
}
