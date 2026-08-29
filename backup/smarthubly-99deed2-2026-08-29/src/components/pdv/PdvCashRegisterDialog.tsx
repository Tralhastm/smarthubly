// Modal de gestão de caixa: abertura, fechamento e sangria/suprimento.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useOpenCashSession, useOpenCash, useCloseCash, useAddCashMovement, useCashMovements, useSessionExpected } from "@/hooks/useCashRegister";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Lock, Unlock } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  operatorName: string;
  operatorRole?: string;
}

const fmt = (n: number) => `R$ ${(Number(n) || 0).toFixed(2).replace(".", ",")}`;

export default function PdvCashRegisterDialog({ open, onOpenChange, tenantId, operatorName, operatorRole }: Props) {
  const { data: session } = useOpenCashSession(tenantId);
  const { data: movements = [] } = useCashMovements(session?.id);
  const { data: expected = 0 } = useSessionExpected(session?.id);
  const openCash = useOpenCash();
  const closeCash = useCloseCash();
  const addMov = useAddCashMovement();

  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("");
  const [movAmount, setMovAmount] = useState("");
  const [movReason, setMovReason] = useState("");
  const [notes, setNotes] = useState("");

  const doOpen = async () => {
    const amount = Number(opening.replace(",", "."));
    if (isNaN(amount) || amount < 0) return toast.error("Valor inválido");
    try {
      await openCash.mutateAsync({ tenantId, operatorName, operatorRole, openingAmount: amount });
      toast.success("Caixa aberto!");
      setOpening("0");
    } catch (e: any) { toast.error(e.message); }
  };

  const doClose = async () => {
    if (!session) return;
    const amount = Number(closing.replace(",", "."));
    if (isNaN(amount) || amount < 0) return toast.error("Valor inválido");
    try {
      const r = await closeCash.mutateAsync({ sessionId: session.id, closingAmount: amount, closedBy: operatorName, notes });
      const msg = r.difference === 0 ? "Caixa fechado, bateu certinho!" : r.difference > 0 ? `Caixa fechado com sobra de ${fmt(r.difference)}` : `Caixa fechado com falta de ${fmt(Math.abs(r.difference))}`;
      toast.success(msg);
      setClosing(""); setNotes("");
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); }
  };

  const doMovement = async (type: "sangria" | "suprimento") => {
    if (!session) return;
    const amount = Number(movAmount.replace(",", "."));
    if (isNaN(amount) || amount <= 0) return toast.error("Valor inválido");
    try {
      await addMov.mutateAsync({ sessionId: session.id, tenantId, type, amount, reason: movReason, operatorName });
      toast.success(`${type === "sangria" ? "Sangria" : "Suprimento"} registrado`);
      setMovAmount(""); setMovReason("");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Caixa</DialogTitle>
          <DialogDescription>
            {session ? `Aberto por ${session.operator_name} em ${new Date(session.opened_at).toLocaleString("pt-BR")}` : "Nenhuma sessão aberta"}
          </DialogDescription>
        </DialogHeader>

        {!session ? (
          <div className="space-y-3">
            <div>
              <Label>Valor inicial em caixa (R$)</Label>
              <Input value={opening} onChange={e => setOpening(e.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <Button onClick={doOpen} disabled={openCash.isPending} className="w-full">
              <Unlock className="w-4 h-4 mr-2" /> Abrir caixa
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="resumo">
            <TabsList className="grid grid-cols-3">
              <TabsTrigger value="resumo">Resumo</TabsTrigger>
              <TabsTrigger value="mov">Movimentar</TabsTrigger>
              <TabsTrigger value="fechar">Fechar</TabsTrigger>
            </TabsList>

            <TabsContent value="resumo" className="space-y-2">
              <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Abertura</span><b>{fmt(session.opening_amount)}</b></div>
                <div className="flex justify-between text-primary"><span>Esperado em caixa</span><b>{fmt(expected)}</b></div>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {movements.length === 0 && <div className="text-xs text-muted-foreground text-center py-2">Sem movimentações</div>}
                {movements.map(m => (
                  <div key={m.id} className="flex justify-between items-center text-xs border rounded p-2">
                    <div>
                      <div className="font-medium capitalize flex items-center gap-1">
                        {m.type === "sangria" ? <ArrowDownCircle className="w-3 h-3 text-destructive" /> : <ArrowUpCircle className="w-3 h-3 text-green-600" />}
                        {m.type}
                      </div>
                      {m.reason && <div className="text-muted-foreground">{m.reason}</div>}
                    </div>
                    <b className={m.type === "sangria" ? "text-destructive" : "text-green-600"}>
                      {m.type === "sangria" ? "-" : "+"}{fmt(m.amount)}
                    </b>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="mov" className="space-y-3">
              <div>
                <Label>Valor (R$)</Label>
                <Input value={movAmount} onChange={e => setMovAmount(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
              <div>
                <Label>Motivo</Label>
                <Input value={movReason} onChange={e => setMovReason(e.target.value)} placeholder="Ex: troco, pagto fornecedor..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => doMovement("suprimento")} disabled={addMov.isPending}>
                  <ArrowUpCircle className="w-4 h-4 mr-1 text-green-600" /> Suprimento
                </Button>
                <Button variant="outline" onClick={() => doMovement("sangria")} disabled={addMov.isPending}>
                  <ArrowDownCircle className="w-4 h-4 mr-1 text-destructive" /> Sangria
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="fechar" className="space-y-3">
              <div className="bg-muted/30 rounded-lg p-3 text-sm">
                <div className="flex justify-between"><span>Esperado</span><b>{fmt(expected)}</b></div>
              </div>
              <div>
                <Label>Valor conferido em caixa (R$)</Label>
                <Input value={closing} onChange={e => setClosing(e.target.value)} placeholder="0,00" inputMode="decimal" autoFocus />
              </div>
              <div>
                <Label>Observações (opcional)</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
              </div>
              <Button onClick={doClose} disabled={closeCash.isPending || !closing} className="w-full" variant="destructive">
                <Lock className="w-4 h-4 mr-2" /> Fechar caixa
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
