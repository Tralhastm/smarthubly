// Escolha de forma de pagamento — agora com suporte a split (várias formas).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CreditCard, Smartphone, Banknote, NotebookPen, Split, X } from "lucide-react";

export type PdvPaymentMethod = "credit_card" | "debit_card" | "pix" | "dinheiro" | "fiado";

export type SplitEntry = { method: PdvPaymentMethod; amount: number };

interface Props {
  total: number;
  onBack: () => void;
  onPay: (method: PdvPaymentMethod, split?: SplitEntry[]) => void;
  loading?: boolean;
}

const opts: { method: PdvPaymentMethod; label: string; sub: string; icon: any }[] = [
  { method: "credit_card", label: "Cartão crédito", sub: "Cobre no app da maquininha", icon: CreditCard },
  { method: "debit_card", label: "Cartão débito", sub: "Cobre no app da maquininha", icon: CreditCard },
  { method: "pix", label: "PIX", sub: "Mostre o QR / chave", icon: Smartphone },
  { method: "dinheiro", label: "Dinheiro", sub: "Recebido em espécie", icon: Banknote },
  { method: "fiado", label: "Fiado", sub: "Vai pra contas a receber", icon: NotebookPen },
];

const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const labelOf = (m: PdvPaymentMethod) => opts.find(o => o.method === m)?.label || m;

export default function PdvPayment({ total, onBack, onPay, loading }: Props) {
  const [splitMode, setSplitMode] = useState(false);
  const [entries, setEntries] = useState<SplitEntry[]>([]);
  const [curMethod, setCurMethod] = useState<PdvPaymentMethod>("dinheiro");
  const [curAmount, setCurAmount] = useState("");

  const paid = entries.reduce((s, e) => s + e.amount, 0);
  const remaining = Math.max(0, total - paid);

  const addEntry = () => {
    const amt = Number(curAmount.replace(",", "."));
    if (isNaN(amt) || amt <= 0) return;
    setEntries(prev => [...prev, { method: curMethod, amount: Math.min(amt, remaining) }]);
    setCurAmount("");
  };

  const removeEntry = (i: number) => setEntries(prev => prev.filter((_, idx) => idx !== i));

  const finalizeSplit = () => {
    if (entries.length === 0) return;
    if (paid < total - 0.01) return;
    onPay(entries[entries.length - 1].method, entries);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <header className="px-3 py-2 border-b flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} disabled={loading}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <div className="text-[10px] uppercase text-muted-foreground">Pagamento</div>
          <div className="text-sm font-semibold">{splitMode ? "Dividir conta" : "Como vai pagar?"}</div>
        </div>
        <Button size="sm" variant={splitMode ? "default" : "outline"} onClick={() => { setSplitMode(!splitMode); setEntries([]); }}>
          <Split className="w-4 h-4 mr-1" /> Split
        </Button>
      </header>

      <div className="bg-primary text-primary-foreground p-4 text-center">
        <div className="text-xs uppercase tracking-wider opacity-80">{splitMode ? "Falta pagar" : "Total a cobrar"}</div>
        <div className="text-3xl font-bold mt-1">{fmt(splitMode ? remaining : total)}</div>
        {splitMode && <div className="text-xs opacity-80 mt-1">Total {fmt(total)} · pago {fmt(paid)}</div>}
      </div>

      {!splitMode ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {opts.map(o => {
            const Icon = o.icon;
            return (
              <button
                key={o.method}
                onClick={() => onPay(o.method)}
                disabled={loading}
                className="w-full bg-card border rounded-xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold">{o.label}</div>
                  <div className="text-xs text-muted-foreground">{o.sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="space-y-1">
            {entries.map((e, i) => (
              <div key={i} className="flex items-center justify-between border rounded p-2 text-sm">
                <span>{labelOf(e.method)}</span>
                <div className="flex items-center gap-2">
                  <b>{fmt(e.amount)}</b>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeEntry(i)}><X className="w-3 h-3" /></Button>
                </div>
              </div>
            ))}
          </div>

          {remaining > 0.01 && (
            <div className="border rounded-xl p-3 space-y-2 bg-card">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Adicionar pagamento</div>
              <div className="grid grid-cols-3 gap-1">
                {opts.map(o => (
                  <button key={o.method} onClick={() => setCurMethod(o.method)}
                    className={`text-xs p-2 rounded border ${curMethod === o.method ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                    {o.label.split(" ")[0]}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={curAmount} onChange={e => setCurAmount(e.target.value)} placeholder={`Até ${fmt(remaining)}`} inputMode="decimal" />
                <Button onClick={() => { setCurAmount(remaining.toFixed(2)); }} variant="outline">Resto</Button>
              </div>
              <Button onClick={addEntry} className="w-full" disabled={!curAmount}>Adicionar</Button>
            </div>
          )}

          <Button onClick={finalizeSplit} disabled={loading || paid < total - 0.01} className="w-full" size="lg">
            Finalizar venda
          </Button>
        </div>
      )}
    </div>
  );
}
