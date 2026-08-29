// Cupom final + opção de imprimir.
import { Button } from "@/components/ui/button";
import { CheckCircle2, Printer, Plus } from "lucide-react";
import type { PdvCartItem } from "@/hooks/usePdvSession";

interface Props {
  storeName: string;
  orderId: string;
  items: PdvCartItem[];
  total: number;
  paymentLabel: string;
  operatorName: string;
  contextLabel: string;
  onNew: () => void;
}

export default function PdvReceipt({ storeName, orderId, items, total, paymentLabel, operatorName, contextLabel, onNew }: Props) {
  const print = () => {
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;
    const html = `
      <html><head><title>Cupom</title>
      <style>
        @page { size: 58mm auto; margin: 2mm; }
        body { font-family: monospace; font-size: 11px; margin: 0; padding: 4px; }
        h2 { text-align: center; margin: 4px 0; font-size: 13px; }
        .row { display: flex; justify-content: space-between; gap: 4px; }
        .total { font-size: 14px; font-weight: bold; border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; }
        .center { text-align: center; margin: 6px 0; }
        hr { border: none; border-top: 1px dashed #000; }
      </style></head><body>
      <h2>${storeName}</h2>
      <div class="center">CUPOM NÃO FISCAL</div>
      <div>Pedido: ${orderId.slice(0,8).toUpperCase()}</div>
      <div>Operador: ${operatorName}</div>
      <div>${contextLabel}</div>
      <div>${new Date().toLocaleString("pt-BR")}</div>
      <hr/>
      ${items.map(i => `
        <div class="row"><span>${i.quantity}x ${i.name}</span><span>R$ ${(i.price*i.quantity).toFixed(2)}</span></div>
      `).join("")}
      <div class="row total"><span>TOTAL</span><span>R$ ${total.toFixed(2)}</span></div>
      <div class="row"><span>Pagamento</span><span>${paymentLabel}</span></div>
      <div class="center">Obrigado!</div>
      </body></html>`;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); }, 200);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle2 className="w-20 h-20 text-success mb-4" />
        <h1 className="text-2xl font-bold mb-1">Venda realizada!</h1>
        <div className="text-sm text-muted-foreground">Pedido #{orderId.slice(0,8).toUpperCase()}</div>
        <div className="text-4xl font-bold mt-6 text-primary">R$ {total.toFixed(2).replace(".", ",")}</div>
        <div className="text-sm text-muted-foreground mt-1">{paymentLabel}</div>
        <div className="text-xs text-muted-foreground mt-4">{items.length} {items.length === 1 ? "item" : "itens"} • {contextLabel}</div>
      </div>

      <div className="p-3 space-y-2 border-t bg-card">
        <Button variant="outline" className="w-full h-12 gap-2" onClick={print}>
          <Printer className="w-4 h-4" /> Imprimir cupom
        </Button>
        <Button className="w-full h-14 text-base gap-2" onClick={onNew}>
          <Plus className="w-5 h-5" /> Nova venda
        </Button>
      </div>
    </div>
  );
}
