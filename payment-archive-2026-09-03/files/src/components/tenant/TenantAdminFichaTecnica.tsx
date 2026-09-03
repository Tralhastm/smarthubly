// Ficha técnica: aba com 3 sub-painéis — ingredientes, receitas por produto, DRE.
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import {
  useIngredients, useSaveIngredient, useDeleteIngredient,
  useProductRecipe, useUpsertRecipeRow, useDeleteRecipeRow, useProductCMV,
  useDRE, type Ingredient,
} from "@/hooks/useFichaTecnica";
import { useProducts } from "@/hooks/useProducts";
import { useSubTabs } from "@/lib/admin-subtabs";

const UNITS = ["un", "g", "kg", "ml", "L", "fatia", "porção"];
const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function TenantAdminFichaTecnica({ tenantId }: { tenantId: string }) {
  const subs = useSubTabs('ficha', [
    { id: 'ingredients', label: 'Ingredientes' },
    { id: 'recipes', label: 'Receitas (CMV por produto)' },
    { id: 'dre', label: 'DRE' },
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Ficha Técnica / CMV / DRE</h2>
        <p className="text-muted-foreground text-sm">
          Cadastre ingredientes, monte a receita de cada produto e veja seu lucro real.
        </p>
      </div>
      <Tabs defaultValue={subs[0].id}>
        <TabsList>
          {subs.map(s => <TabsTrigger key={s.id} value={s.id}>{s.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="ingredients" className="mt-4">
          <IngredientsPanel tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="recipes" className="mt-4">
          <RecipesPanel tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="dre" className="mt-4">
          <DrePanel tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- INGREDIENTES ----
function IngredientsPanel({ tenantId }: { tenantId: string }) {
  const { data: ingredients = [] } = useIngredients(tenantId);
  const save = useSaveIngredient(tenantId);
  const del = useDeleteIngredient(tenantId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Ingredient> | null>(null);
  const [calcQty, setCalcQty] = useState("");
  const [calcTotal, setCalcTotal] = useState("");

  const lowStock = ingredients.filter(i => i.stock_min > 0 && i.stock <= i.stock_min);

  const startNew = () => {
    setEditing({ name: "", unit: "un", cost_per_unit: 1, stock: 0, stock_min: 0 });
    setCalcQty("");
    setCalcTotal("");
    setOpen(true);
  };
  const startEdit = (it: Ingredient) => {
    setEditing(it);
    setCalcQty("");
    setCalcTotal("");
    setOpen(true);
  };

  const applyCalc = () => {
    const q = Number(calcQty);
    const t = Number(calcTotal);
    if (q > 0 && t > 0) {
      const unitCost = Number((t / q).toFixed(6));
      setEditing(prev => prev ? { ...prev, cost_per_unit: unitCost } : prev);
      toast.success(`Custo calculado: ${fmtBRL(unitCost)} por ${editing?.unit || "un"}`);
    } else {
      toast.error("Preencha quantidade e preço total");
    }
  };

  const handleSave = async () => {
    if (!editing?.name) return toast.error("Nome obrigatório");
    try {
      await save.mutateAsync(editing as any);
      toast.success("Salvo");
      setOpen(false);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle>Ingredientes ({ingredients.length})</CardTitle>
        <Button onClick={startNew}><Plus className="h-4 w-4 mr-2" />Novo</Button>
      </CardHeader>
      <CardContent>
        {lowStock.length > 0 && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm flex gap-2 items-center">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span><strong>{lowStock.length}</strong> ingrediente(s) em estoque baixo: {lowStock.map(i => i.name).join(", ")}</span>
          </div>
        )}
        <div className="space-y-2">
          {ingredients.length === 0 && (
            <p className="text-muted-foreground text-sm py-8 text-center">Nenhum ingrediente cadastrado ainda.</p>
          )}
          {ingredients.map(i => {
            const low = i.stock_min > 0 && i.stock <= i.stock_min;
            return (
              <div key={i.id} className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/40">
                <div className="flex-1">
                  <div className="font-medium flex items-center gap-2">
                    {i.name}
                    {low && <Badge variant="destructive" className="text-xs">Estoque baixo</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtBRL(Number(i.cost_per_unit))} / {i.unit} · Estoque: {i.stock} {i.unit}
                    {i.supplier && ` · ${i.supplier}`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => startEdit(i)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    if (confirm(`Excluir "${i.name}"?`)) del.mutate(i.id);
                  }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} ingrediente</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Unidade</Label>
                  <Select value={editing.unit || "un"} onValueChange={v => setEditing({ ...editing, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Custo por unidade (R$)</Label>
                  <Input type="number" step="0.0001" value={editing.cost_per_unit ?? 1}
                    onChange={e => setEditing({ ...editing, cost_per_unit: Number(e.target.value) })} />
                </div>
              </div>

              <div className="border rounded-md p-3 bg-muted/20 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Não sabe o preço por {editing.unit || "un"}? Calcule aqui:</p>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <Label className="text-xs">Quantidade comprada</Label>
                    <Input type="number" step="1" placeholder="150" value={calcQty}
                      onChange={e => setCalcQty(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Preço total pago (R$)</Label>
                    <Input type="number" step="0.01" placeholder="15,00" value={calcTotal}
                      onChange={e => setCalcTotal(e.target.value)} />
                  </div>
                  <Button variant="outline" size="sm" onClick={applyCalc}>Calcular</Button>
                </div>
                {Number(calcQty) > 1 && Number(calcTotal) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Resultado: cada {editing.unit || "un"} sai a {fmtBRL(Number(calcTotal) / Number(calcQty))}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Estoque atual</Label>
                  <Input type="number" step="0.001" value={editing.stock ?? 0}
                    onChange={e => setEditing({ ...editing, stock: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Estoque mínimo (alerta)</Label>
                  <Input type="number" step="0.001" value={editing.stock_min ?? 0}
                    onChange={e => setEditing({ ...editing, stock_min: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label>Fornecedor (opcional)</Label>
                <Input value={editing.supplier || ""} onChange={e => setEditing({ ...editing, supplier: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---- RECEITAS ----
function RecipesPanel({ tenantId }: { tenantId: string }) {
  const { data: products = [] } = useProducts(tenantId);
  const [productId, setProductId] = useState<string>("");
  const product = products.find((p: any) => p.id === productId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Selecione o produto</CardTitle></CardHeader>
        <CardContent>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger><SelectValue placeholder="Escolha um produto..." /></SelectTrigger>
            <SelectContent>
              {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {productId && product && <RecipeEditor tenantId={tenantId} productId={productId} productName={product.name} productPrice={Number(product.price || 0)} />}
    </div>
  );
}

function RecipeEditor({ tenantId, productId, productName, productPrice }:
  { tenantId: string; productId: string; productName: string; productPrice: number }) {
  const { data: ingredients = [] } = useIngredients(tenantId);
  const { data: recipe = [] } = useProductRecipe(productId);
  const { data: cmv = 0 } = useProductCMV(productId);
  const upsert = useUpsertRecipeRow(productId);
  const del = useDeleteRecipeRow(productId);

  const [selIng, setSelIng] = useState("");
  const [qty, setQty] = useState("0");

  const margin = productPrice > 0 ? ((productPrice - cmv) / productPrice * 100) : 0;
  const usedIds = new Set(recipe.map(r => r.ingredient_id));
  const available = ingredients.filter(i => !usedIds.has(i.id));

  const add = async () => {
    if (!selIng || Number(qty) <= 0) return toast.error("Selecione ingrediente e quantidade");
    try {
      await upsert.mutateAsync({ tenant_id: tenantId, product_id: productId, ingredient_id: selIng, quantity: Number(qty) });
      setSelIng(""); setQty("0");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{productName}</CardTitle>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Metric label="Preço de venda" value={fmtBRL(productPrice)} />
          <Metric label="CMV (custo)" value={fmtBRL(cmv)} />
          <Metric label="Margem" value={`${margin.toFixed(1)}%`}
            tone={margin >= 60 ? "good" : margin >= 30 ? "warn" : "bad"} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 mb-4">
          {recipe.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Sem ingredientes cadastrados nessa receita.</p>}
          {recipe.map(r => {
            const ing = r.ingredient;
            const lineCost = ing ? Number(ing.cost_per_unit) * Number(r.quantity) : 0;
            return (
              <div key={r.id} className="flex items-center justify-between p-2 border rounded-md">
                <div>
                  <div className="font-medium text-sm">{ing?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.quantity} {ing?.unit} × {fmtBRL(Number(ing?.cost_per_unit || 0))} = <strong>{fmtBRL(lineCost)}</strong>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
        </div>
        <div className="border-t pt-4 space-y-2">
          <Label className="text-sm font-semibold">Adicionar ingrediente</Label>
          <div className="flex gap-2">
            <Select value={selIng} onValueChange={setSelIng}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Ingrediente..." /></SelectTrigger>
              <SelectContent>
                {available.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="number" step="0.001" className="w-24" placeholder="Qtde"
              value={qty} onChange={e => setQty(e.target.value)} />
            <Button onClick={add} disabled={upsert.isPending}><Plus className="h-4 w-4" /></Button>
          </div>
          {ingredients.length === 0 && (
            <p className="text-xs text-muted-foreground">Cadastre ingredientes na aba anterior primeiro.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-green-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-destructive" : "";
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

// ---- DRE ----
function DrePanel({ tenantId }: { tenantId: string }) {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(first.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const fromIso = useMemo(() => new Date(from + "T00:00:00").toISOString(), [from]);
  const toIso = useMemo(() => new Date(to + "T23:59:59").toISOString(), [to]);
  const { data, isLoading } = useDRE(tenantId, fromIso, toIso);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demonstrativo do período</CardTitle>
        <div className="flex gap-2 mt-2">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Calculando...</p>}
        {data && (
          <div className="space-y-2">
            <Row label="Receita bruta (vendas)" value={data.revenue} positive />
            <Row label="(-) CMV (custo dos ingredientes)" value={-data.cmv} />
            <Row label="= Lucro bruto" value={data.gross_profit} bold
              extra={`Margem ${data.gross_margin_pct}%`}
              tone={data.gross_profit >= 0 ? "good" : "bad"} />
            <div className="border-t my-2" />
            <Row label="(-) Taxa da plataforma" value={-data.platform_fee} />
            <Row label="(-) Outras despesas" value={-data.expenses} />
            <div className="border-t my-2" />
            <Row label="= Lucro líquido" value={data.net_profit} bold
              tone={data.net_profit >= 0 ? "good" : "bad"} big />
            {data.cmv === 0 && data.revenue > 0 && (
              <p className="text-xs text-amber-600 mt-3">
                ⚠️ CMV zerado — cadastre as receitas dos produtos pra ver o custo real.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold, positive, big, tone, extra }:
  { label: string; value: number; bold?: boolean; positive?: boolean; big?: boolean; tone?: "good" | "bad"; extra?: string }) {
  const color = tone === "good" ? "text-green-600" : tone === "bad" ? "text-destructive" : "";
  return (
    <div className={`flex justify-between items-center ${bold ? "font-bold" : ""} ${big ? "text-lg" : ""}`}>
      <span className="flex items-center gap-2">
        {label}
        {extra && <Badge variant="outline" className="text-xs">{extra}</Badge>}
      </span>
      <span className={color}>
        {tone === "good" && <TrendingUp className="inline h-4 w-4 mr-1" />}
        {tone === "bad" && <TrendingDown className="inline h-4 w-4 mr-1" />}
        {fmtBRL(value)}
      </span>
    </div>
  );
}
