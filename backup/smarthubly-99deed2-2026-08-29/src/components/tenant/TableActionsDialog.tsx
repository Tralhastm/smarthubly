// Diálogo de ações de mesa: transferir mesa OU dividir conta por pessoa.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ArrowRightLeft, Split, Printer, Plus, Minus } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  session: any; // table_sessions row
  tenantId: string;
  onTransferred?: () => void;
}

type Item = { id: string; product_name: string; product_price: number; quantity: number };
type Person = { name: string; itemIds: Record<string, number> /* itemId -> qty */ };

export default function TableActionsDialog({ open, onClose, session, tenantId, onTransferred }: Props) {
  const [tab, setTab] = useState<"transfer" | "split">("transfer");
  const [tables, setTables] = useState<{ id: string; label: string }[]>([]);
  const [busyTableIds, setBusyTableIds] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState<string>("");
  const [transferring, setTransferring] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [people, setPeople] = useState<Person[]>([{ name: "Pessoa 1", itemIds: {} }, { name: "Pessoa 2", itemIds: {} }]);

  useEffect(() => {
    if (!open || !session) return;
    (async () => {
      const [tablesRes, sessionsRes, itemsRes] = await Promise.all([
        (supabase as any).from("restaurant_tables").select("id,label").eq("tenant_id", tenantId).eq("active", true).order("label"),
        (supabase as any).from("table_sessions").select("table_id").eq("tenant_id", tenantId).in("status", ["open", "sent"]),
        (supabase as any).from("table_session_items").select("id,product_name,product_price,quantity").eq("session_id", session.id),
      ]);
      setTables((tablesRes.data || []).filter((t: any) => t.id !== session.table_id));
      setBusyTableIds(new Set((sessionsRes.data || []).map((s: any) => s.table_id)));
      setItems(itemsRes.data || []);
      setPeople([{ name: "Pessoa 1", itemIds: {} }, { name: "Pessoa 2", itemIds: {} }]);
    })();
  }, [open, session, tenantId]);

  const doTransfer = async () => {
    if (!targetId) return toast.error("Escolha uma mesa de destino");
    if (busyTableIds.has(targetId)) return toast.error("Essa mesa está ocupada");
    const target = tables.find(t => t.id === targetId);
    if (!target) return;
    setTransferring(true);
    try {
      const { error } = await (supabase as any).from("table_sessions")
        .update({ table_id: target.id, table_label: target.label })
        .eq("id", session.id);
      if (error) throw error;
      // Se já há pedido vinculado, atualiza label também
      if (session.order_id) {
        await (supabase as any).from("orders").update({ table_label: target.label }).eq("id", session.order_id);
      }
      toast.success(`Mesa transferida para ${target.label}`);
      onTransferred?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Falha ao transferir");
    } finally {
      setTransferring(false);
    }
  };

  // SPLIT helpers
  const assignedQty = (itemId: string) =>
    people.reduce((s, p) => s + (p.itemIds[itemId] || 0), 0);

  const adjust = (personIdx: number, itemId: string, delta: number) => {
    setPeople(prev => {
      const next = prev.map((p, i) => i === personIdx ? { ...p, itemIds: { ...p.itemIds } } : p);
      const target = items.find(it => it.id === itemId);
      if (!target) return prev;
      const cur = next[personIdx].itemIds[itemId] || 0;
      const used = assignedQty(itemId);
      const newVal = cur + delta;
      if (newVal < 0) return prev;
      if (delta > 0 && used >= target.quantity) return prev;
      next[personIdx].itemIds[itemId] = newVal;
      if (newVal === 0) delete next[personIdx].itemIds[itemId];
      return next;
    });
  };

  const addPerson = () => setPeople(prev => [...prev, { name: `Pessoa ${prev.length + 1}`, itemIds: {} }]);
  const removePerson = (i: number) => setPeople(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const distributeEqually = () => {
    const n = people.length;
    if (n === 0) return;
    setPeople(prev => prev.map(p => ({ ...p, itemIds: {} })));
    setTimeout(() => {
      setPeople(prev => {
        const next = prev.map(p => ({ ...p, itemIds: { ...p.itemIds } }));
        items.forEach(it => {
          const base = Math.floor(it.quantity / n);
          let rem = it.quantity - base * n;
          for (let i = 0; i < n; i++) {
            const extra = rem > 0 ? 1 : 0;
            const q = base + extra;
            if (q > 0) next[i].itemIds[it.id] = q;
            rem -= extra;
          }
        });
        return next;
      });
    }, 0);
  };

  const personTotal = (p: Person) =>
    Object.entries(p.itemIds).reduce((s, [itemId, q]) => {
      const it = items.find(i => i.id === itemId);
      return s + (it ? Number(it.product_price) * q : 0);
    }, 0);

  const fullTotal = items.reduce((s, it) => s + Number(it.product_price) * it.quantity, 0);
  const assigned = people.reduce((s, p) => s + personTotal(p), 0);
  const remaining = fullTotal - assigned;

  const printSplit = () => {
    const html = `
      <html><head><meta charset="utf-8"><title>Divisão de conta - ${session.table_label}</title>
      <style>body{font-family:monospace;font-size:12px;padding:10px}.p{border-bottom:1px dashed #999;padding:8px 0;page-break-inside:avoid}.t{font-weight:bold;font-size:14px}.r{display:flex;justify-content:space-between}</style>
      </head><body>
      <div class="t">Mesa ${session.table_label} — Divisão</div>
      <div>Total: R$ ${fullTotal.toFixed(2)}</div>
      ${people.map((p) => `
        <div class="p">
          <div class="t">${p.name}</div>
          ${Object.entries(p.itemIds).map(([id, q]) => {
            const it = items.find(i => i.id === id);
            if (!it) return "";
            return `<div class="r"><span>${q}x ${it.product_name}</span><span>R$ ${(Number(it.product_price) * q).toFixed(2)}</span></div>`;
          }).join("")}
          <div class="r t" style="margin-top:6px"><span>Total</span><span>R$ ${personTotal(p).toFixed(2)}</span></div>
        </div>
      `).join("")}
      </body></html>`;
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return toast.error("Bloqueador de popup ativo");
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 200);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Mesa {session?.table_label}</DialogTitle>
          <DialogDescription>Transferir mesa ou dividir a conta por pessoa</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as any)} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="transfer"><ArrowRightLeft className="w-4 h-4 mr-1" /> Transferir mesa</TabsTrigger>
            <TabsTrigger value="split"><Split className="w-4 h-4 mr-1" /> Dividir conta</TabsTrigger>
          </TabsList>

          <TabsContent value="transfer" className="space-y-3">
            <Label>Mover para</Label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[40vh] overflow-y-auto">
              {tables.length === 0 && <div className="col-span-full text-sm text-muted-foreground p-4 text-center">Sem outras mesas</div>}
              {tables.map(t => {
                const busy = busyTableIds.has(t.id);
                const sel = targetId === t.id;
                return (
                  <Button key={t.id} variant={sel ? "default" : "outline"} className="h-16 flex-col gap-0 relative" disabled={busy} onClick={() => setTargetId(t.id)}>
                    <span className="text-[10px] opacity-70">Mesa</span>
                    <span className="font-bold text-lg">{t.label}</span>
                    {busy && <span className="absolute top-1 right-1 text-[9px] text-destructive">ocupada</span>}
                  </Button>
                );
              })}
            </div>
            <Button className="w-full" onClick={doTransfer} disabled={!targetId || transferring}>
              {transferring ? "Transferindo..." : "Confirmar transferência"}
            </Button>
          </TabsContent>

          <TabsContent value="split" className="space-y-3 overflow-y-auto">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm text-muted-foreground">
                Total: <b>R$ {fullTotal.toFixed(2)}</b> · Distribuído: <b className={remaining > 0 ? "text-amber-600" : "text-green-600"}>R$ {assigned.toFixed(2)}</b>
                {remaining > 0 && <span className="text-destructive ml-2">Falta R$ {remaining.toFixed(2)}</span>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={distributeEqually}>Dividir igual</Button>
                <Button size="sm" variant="outline" onClick={addPerson}>+ Pessoa</Button>
                <Button size="sm" variant="outline" onClick={printSplit} disabled={assigned === 0}><Printer className="w-3 h-3 mr-1" /> Imprimir</Button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              {people.map((p, pIdx) => (
                <Card key={pIdx} className="p-2 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <Input value={p.name} onChange={e => setPeople(prev => prev.map((x, i) => i === pIdx ? { ...x, name: e.target.value } : x))} className="h-7 text-sm font-semibold" />
                    {people.length > 1 && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removePerson(pIdx)}>×</Button>}
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {items.map(it => {
                      const cur = p.itemIds[it.id] || 0;
                      const used = assignedQty(it.id);
                      const canAdd = used < it.quantity;
                      return (
                        <div key={it.id} className="flex items-center gap-1 text-xs">
                          <div className="flex-1 truncate">{it.product_name} <span className="text-muted-foreground">({used}/{it.quantity})</span></div>
                          <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => adjust(pIdx, it.id, -1)} disabled={cur <= 0}><Minus className="w-3 h-3" /></Button>
                          <span className="w-5 text-center font-bold">{cur}</span>
                          <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => adjust(pIdx, it.id, 1)} disabled={!canAdd}><Plus className="w-3 h-3" /></Button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-sm font-bold pt-1 border-t">
                    <span>Total</span><span className="text-primary">R$ {personTotal(p).toFixed(2)}</span>
                  </div>
                </Card>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Esta divisão é só pra cobrança no balcão. O pedido único na cozinha continua o mesmo.
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
