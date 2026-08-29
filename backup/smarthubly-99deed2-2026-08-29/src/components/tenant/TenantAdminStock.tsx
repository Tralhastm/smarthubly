// Painel de Estoque profundo: movimentações, inventário, baixa em estoque e relatório de perdas.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useIngredients } from "@/hooks/useFichaTecnica";
import { useStockMovements, useAddStockMovement, useStockCounts, useAddStockCount, useLowStock, useWasteReport, type StockMovement } from "@/hooks/useStock";
import { toast } from "sonner";
import { useSubTabs } from "@/lib/admin-subtabs";
import { Package, AlertTriangle, ClipboardList, TrendingDown, ArrowDownCircle, ArrowUpCircle, Trash2, ClipboardCheck } from "lucide-react";

const fmt = (n: number) => `R$ ${(Number(n) || 0).toFixed(2).replace(".", ",")}`;
const TYPE_LABEL: Record<StockMovement["type"], string> = {
  entrada: "Entrada", saida: "Saída", perda: "Perda", ajuste: "Ajuste", venda: "Venda (baixa auto)", transferencia: "Transferência",
};

export default function TenantAdminStock({ tenantId }: { tenantId: string }) {
  const subs = useSubTabs('stock', [
    { id: 'movimentar', label: 'Movimentar', icon: <ArrowUpCircle className="w-4 h-4 mr-1" /> },
    { id: 'inventario', label: 'Inventário', icon: <ClipboardCheck className="w-4 h-4 mr-1" /> },
    { id: 'baixa', label: 'Em baixa', icon: <AlertTriangle className="w-4 h-4 mr-1" /> },
    { id: 'historico', label: 'Histórico', icon: <ClipboardList className="w-4 h-4 mr-1" /> },
    { id: 'perdas', label: 'Perdas', icon: <Trash2 className="w-4 h-4 mr-1" /> },
  ]);
  const { data: ingredients = [] } = useIngredients(tenantId);
  const { data: movements = [] } = useStockMovements(tenantId, 200);
  const { data: counts = [] } = useStockCounts(tenantId);
  const { data: low = [] } = useLowStock(tenantId);
  const addMov = useAddStockMovement(tenantId);
  const addCount = useAddStockCount(tenantId);

  // Form movimentação
  const [movIng, setMovIng] = useState("");
  const [movType, setMovType] = useState<StockMovement["type"]>("entrada");
  const [movQty, setMovQty] = useState("");
  const [movReason, setMovReason] = useState("");
  const [movBatch, setMovBatch] = useState("");
  const [movExp, setMovExp] = useState("");

  // Form contagem
  const [countIng, setCountIng] = useState("");
  const [countQty, setCountQty] = useState("");
  const [countNotes, setCountNotes] = useState("");

  // Período relatório perdas
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const { data: waste = [] } = useWasteReport(tenantId, from + "T00:00:00", to + "T23:59:59");

  const wasteTotal = useMemo(() => waste.reduce((s, w) => s + Number(w.quantity) * Number(w.ingredient?.cost_per_unit || 0), 0), [waste]);

  const submitMov = async () => {
    const qty = Number(movQty.replace(",", "."));
    if (!movIng) return toast.error("Escolha o ingrediente");
    if (isNaN(qty) || qty <= 0) return toast.error("Quantidade inválida");
    try {
      await addMov.mutateAsync({
        ingredient_id: movIng, type: movType, quantity: qty,
        reason: movReason || null, batch_code: movBatch || null, expires_at: movExp || null,
      });
      toast.success("Movimentação registrada");
      setMovQty(""); setMovReason(""); setMovBatch(""); setMovExp("");
    } catch (e: any) { toast.error(e.message); }
  };

  const submitCount = async () => {
    const ing = ingredients.find(i => i.id === countIng);
    if (!ing) return toast.error("Escolha o ingrediente");
    const qty = Number(countQty.replace(",", "."));
    if (isNaN(qty) || qty < 0) return toast.error("Quantidade inválida");
    try {
      await addCount.mutateAsync({ ingredient_id: ing.id, counted_qty: qty, system_qty: Number(ing.stock || 0), notes: countNotes || undefined });
      toast.success("Inventário registrado, saldo ajustado");
      setCountQty(""); setCountNotes("");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Package className="w-3 h-3" /> Ingredientes</div>
            <div className="text-2xl font-bold">{ingredients.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><AlertTriangle className="w-3 h-3" /> Em baixa</div>
            <div className="text-2xl font-bold text-destructive">{low.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><ClipboardList className="w-3 h-3" /> Mov. recentes</div>
            <div className="text-2xl font-bold">{movements.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><TrendingDown className="w-3 h-3" /> Perdas no período</div>
            <div className="text-2xl font-bold text-destructive">{fmt(wasteTotal)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={subs[0].id}>
        <TabsList className="flex w-full flex-wrap justify-start h-auto gap-1">
          {subs.map(s => (
            <TabsTrigger key={s.id} value={s.id} className="flex-shrink-0">{s.icon} {s.label}</TabsTrigger>
          ))}
        </TabsList>

        {/* Movimentar */}
        <TabsContent value="movimentar" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Registrar movimentação</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Ingrediente</Label>
                <Select value={movIng} onValueChange={setMovIng}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {ingredients.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({Number(i.stock || 0)} {i.unit})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={movType} onValueChange={v => setMovType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entrada">Entrada (compra)</SelectItem>
                    <SelectItem value="saida">Saída</SelectItem>
                    <SelectItem value="perda">Perda / Desperdício</SelectItem>
                    <SelectItem value="ajuste">Ajuste manual (+/-)</SelectItem>
                    <SelectItem value="transferencia">Transferência</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Quantidade</Label>
                <Input value={movQty} onChange={e => setMovQty(e.target.value)} placeholder="0" inputMode="decimal" />
              </div>
              <div>
                <Label>Motivo / Observação</Label>
                <Input value={movReason} onChange={e => setMovReason(e.target.value)} placeholder="Ex: nota fiscal 1234, quebra, etc." />
              </div>
              <div>
                <Label>Lote (opcional)</Label>
                <Input value={movBatch} onChange={e => setMovBatch(e.target.value)} placeholder="LOTE-001" />
              </div>
              <div>
                <Label>Validade (opcional)</Label>
                <Input type="date" value={movExp} onChange={e => setMovExp(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Button onClick={submitMov} disabled={addMov.isPending} className="w-full">Registrar</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventário */}
        <TabsContent value="inventario" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Contagem cíclica</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Ingrediente</Label>
                  <Select value={countIng} onValueChange={setCountIng}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {ingredients.map(i => <SelectItem key={i.id} value={i.id}>{i.name} (sistema: {Number(i.stock || 0)} {i.unit})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantidade contada</Label>
                  <Input value={countQty} onChange={e => setCountQty(e.target.value)} placeholder="0" inputMode="decimal" />
                </div>
                <div className="md:col-span-2">
                  <Label>Observações</Label>
                  <Textarea value={countNotes} onChange={e => setCountNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <Button onClick={submitCount} disabled={addCount.isPending} className="w-full">Registrar contagem (ajusta saldo)</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Últimas contagens</CardTitle></CardHeader>
            <CardContent>
              {counts.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">Sem contagens registradas</div> : (
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {counts.map(c => (
                    <div key={c.id} className="flex justify-between items-center text-sm border rounded p-2">
                      <div>
                        <div className="font-medium">{c.ingredient?.name}</div>
                        <div className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR")} • Sistema: {c.system_qty} • Contado: {c.counted_qty}</div>
                      </div>
                      <Badge variant={c.difference === 0 ? "default" : c.difference > 0 ? "secondary" : "destructive"}>
                        {c.difference > 0 ? "+" : ""}{Number(c.difference).toFixed(2)} {c.ingredient?.unit}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Em baixa */}
        <TabsContent value="baixa" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Sugestão de compra</CardTitle></CardHeader>
            <CardContent>
              {low.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">Tudo em ordem! Nenhum ingrediente abaixo do mínimo.</div>
              ) : (
                <div className="space-y-1">
                  {low.map(i => (
                    <div key={i.id} className="flex justify-between items-center border rounded p-2">
                      <div>
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground">Atual: {Number(i.stock || 0)} {i.unit} • Mínimo: {Number(i.stock_min || 0)} {i.unit}{i.supplier ? ` • Forn.: ${i.supplier}` : ""}</div>
                      </div>
                      <Badge variant="destructive">Falta {Number(i.shortage || 0).toFixed(2)} {i.unit}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Histórico */}
        <TabsContent value="historico" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Últimas movimentações</CardTitle></CardHeader>
            <CardContent>
              {movements.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">Sem movimentações</div> : (
                <div className="space-y-1 max-h-[500px] overflow-y-auto">
                  {movements.map(m => {
                    const sign = ["entrada", "ajuste"].includes(m.type) ? "+" : "-";
                    const color = m.type === "perda" ? "text-destructive" : (m.type === "entrada" ? "text-green-600" : "text-foreground");
                    return (
                      <div key={m.id} className="flex justify-between items-center text-sm border rounded p-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{m.ingredient?.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {new Date(m.created_at).toLocaleString("pt-BR")} • {TYPE_LABEL[m.type]}
                            {m.reason ? ` • ${m.reason}` : ""}
                          </div>
                        </div>
                        <div className={`font-bold ${color}`}>{m.type === "ajuste" && Number(m.quantity) < 0 ? "" : sign}{Math.abs(Number(m.quantity)).toFixed(2)} {m.ingredient?.unit}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Perdas */}
        <TabsContent value="perdas" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Relatório de perdas</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>De</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
                <div><Label>Até</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total perdido no período</span>
                <span className="text-lg font-bold text-destructive">{fmt(wasteTotal)}</span>
              </div>
              {waste.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">Nenhuma perda no período 🎉</div> : (
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {waste.map((w, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm border rounded p-2">
                      <div>
                        <div className="font-medium">{w.ingredient?.name}</div>
                        <div className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleString("pt-BR")}{w.reason ? ` • ${w.reason}` : ""}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-destructive">-{Number(w.quantity).toFixed(2)} {w.ingredient?.unit}</div>
                        <div className="text-xs text-muted-foreground">{fmt(Number(w.quantity) * Number(w.ingredient?.cost_per_unit || 0))}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
