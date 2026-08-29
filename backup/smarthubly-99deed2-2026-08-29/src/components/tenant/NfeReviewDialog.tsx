// Tela de revisão da NF: bate itens com ingredientes existentes (ou cria),
// cria fornecedor se preciso, gera entradas de estoque e a conta a pagar — tudo num clique.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useIngredients, type Ingredient } from '@/hooks/useFichaTecnica';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useQueryClient } from '@tanstack/react-query';
import { Check, AlertTriangle, Package, Sparkles, Loader2 } from 'lucide-react';

type ExtractedItem = {
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total: number | null;
  ncm?: string | null;
};

type Extracted = {
  chave_nfe?: string | null;
  supplier_name?: string | null;
  supplier_cnpj?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  total?: number | null;
  kind?: 'payable' | 'receivable' | null;
  items?: ExtractedItem[];
  confidence?: Record<string, number | null>;
  source_type?: 'xml' | 'pdf' | 'image';
};

type ItemRow = {
  item: ExtractedItem;
  action: 'match' | 'create' | 'skip';
  ingredient_id?: string;
  new_name?: string;
  new_unit?: string;
};

interface Props {
  tenantId: string;
  open: boolean;
  extracted: Extracted | null;
  duplicate: { id: string; created_at: string; apr_id: string | null } | null;
  sourceFilename?: string;
  onClose: () => void;
}

const norm = (s?: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function fuzzyMatch(name: string, list: Ingredient[]): Ingredient | null {
  const n = norm(name);
  if (!n) return null;
  // 1) match exato
  const exact = list.find(i => norm(i.name) === n);
  if (exact) return exact;
  // 2) contém
  const contained = list.find(i => norm(i.name).includes(n) || n.includes(norm(i.name)));
  return contained || null;
}

const fmtBRL = (n?: number | null) => ((n ?? 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ConfBadge = ({ score }: { score?: number | null }) => {
  if (score == null) return null;
  if (score >= 0.85) return <Badge variant="secondary" className="text-[10px] gap-1"><Check className="h-2.5 w-2.5" />Alta</Badge>;
  if (score >= 0.6) return <Badge variant="outline" className="text-[10px] gap-1 border-amber-500 text-amber-600">Média</Badge>;
  return <Badge variant="outline" className="text-[10px] gap-1 border-destructive text-destructive"><AlertTriangle className="h-2.5 w-2.5" />Confira</Badge>;
};

export default function NfeReviewDialog({ tenantId, open, extracted, duplicate, sourceFilename, onClose }: Props) {
  const qc = useQueryClient();
  const { data: ingredients = [] } = useIngredients(tenantId);
  const { data: suppliers = [] } = useSuppliers(tenantId);

  const [supplierAction, setSupplierAction] = useState<'match' | 'create' | 'skip'>('create');
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierName, setSupplierName] = useState('');
  const [total, setTotal] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Inicializa quando abre
  useEffect(() => {
    if (!open || !extracted) return;
    setSupplierName(extracted.supplier_name || '');
    setTotal(extracted.total != null ? String(extracted.total) : '');
    setDueDate(extracted.due_date || extracted.issue_date || new Date().toISOString().slice(0, 10));
    // tenta match de fornecedor por nome
    const fuzzySup = suppliers.find(s => norm(s.name) === norm(extracted.supplier_name)) ||
      suppliers.find(s => norm(s.name).includes(norm(extracted.supplier_name)) && norm(extracted.supplier_name).length > 3);
    if (fuzzySup) { setSupplierAction('match'); setSupplierId(fuzzySup.id); }
    else { setSupplierAction(extracted.supplier_name ? 'create' : 'skip'); setSupplierId(''); }

    // monta linhas de itens com match
    const items = extracted.items || [];
    setRows(items.map(it => {
      const match = fuzzyMatch(it.description || '', ingredients);
      return match
        ? { item: it, action: 'match', ingredient_id: match.id }
        : { item: it, action: 'create', new_name: it.description || '', new_unit: it.unit || 'un' };
    }));
  }, [open, extracted, ingredients, suppliers]);

  const summary = useMemo(() => {
    const matched = rows.filter(r => r.action === 'match').length;
    const created = rows.filter(r => r.action === 'create').length;
    const skipped = rows.filter(r => r.action === 'skip').length;
    return { matched, created, skipped, total: rows.length };
  }, [rows]);

  const updateRow = (idx: number, patch: Partial<ItemRow>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const handleConfirm = async () => {
    if (!extracted) return;
    if (!total || !dueDate) { toast.error('Preencha valor total e vencimento'); return; }
    setSaving(true);

    try {
      // 1) Fornecedor
      let finalSupplierId: string | null = null;
      let finalSupplierName = supplierName;
      if (supplierAction === 'match' && supplierId) {
        finalSupplierId = supplierId;
        finalSupplierName = suppliers.find(s => s.id === supplierId)?.name || supplierName;
      } else if (supplierAction === 'create' && supplierName.trim()) {
        const { data: sup, error: sErr } = await (supabase as any)
          .from('suppliers')
          .insert({ tenant_id: tenantId, name: supplierName.trim(), address: '', phone: '' })
          .select('id, name')
          .single();
        if (sErr) throw new Error('Fornecedor: ' + sErr.message);
        finalSupplierId = sup.id;
        finalSupplierName = sup.name;
      }

      // 2) Ingredientes + movimentações de estoque (entrada)
      const stockMovementIds: string[] = [];
      const activeRows = rows.filter(r => r.action !== 'skip');
      for (const r of activeRows) {
        let ingredientId = r.ingredient_id;
        if (r.action === 'create') {
          const name = (r.new_name || r.item.description || '').trim();
          if (!name) continue;
          const { data: ing, error: iErr } = await (supabase as any)
            .from('ingredients')
            .insert({
              tenant_id: tenantId,
              name,
              unit: r.new_unit || r.item.unit || 'un',
              cost_per_unit: r.item.unit_price ?? 0,
              stock: 0,
              stock_min: 0,
              supplier: finalSupplierName || null,
            })
            .select('id')
            .single();
          if (iErr) throw new Error('Ingrediente "' + name + '": ' + iErr.message);
          ingredientId = ing.id;
        }
        if (!ingredientId) continue;
        const qty = Number(r.item.quantity) || 0;
        if (qty <= 0) continue;
        const { data: mv, error: mErr } = await (supabase as any)
          .from('stock_movements')
          .insert({
            tenant_id: tenantId,
            ingredient_id: ingredientId,
            type: 'entrada',
            quantity: qty,
            unit_cost: r.item.unit_price ?? null,
            reason: 'Entrada via NF' + (extracted.chave_nfe ? ` ${String(extracted.chave_nfe).slice(-8)}` : ''),
            operator_name: 'IA — NF',
          })
          .select('id')
          .single();
        if (mErr) throw new Error('Estoque: ' + mErr.message);
        stockMovementIds.push(mv.id);
      }

      // 3) Conta a pagar
      const itemsSummary = activeRows.length
        ? `${activeRows.length} item(ns) — ` + activeRows.slice(0, 3).map(r => (r.new_name || ingredients.find(i => i.id === r.ingredient_id)?.name || r.item.description || '')).filter(Boolean).join(', ') + (activeRows.length > 3 ? '…' : '')
        : '';
      const notes = [
        extracted.supplier_cnpj ? `CNPJ: ${extracted.supplier_cnpj}` : null,
        extracted.chave_nfe ? `Chave: ${extracted.chave_nfe}` : null,
        itemsSummary || null,
      ].filter(Boolean).join(' • ') || null;

      const { data: apr, error: aErr } = await (supabase as any)
        .from('accounts_payable_receivable')
        .insert({
          tenant_id: tenantId,
          kind: extracted.kind === 'receivable' ? 'receivable' : 'payable',
          description: itemsSummary || (finalSupplierName ? `NF — ${finalSupplierName}` : 'Nota fiscal'),
          amount: Number(total),
          due_date: dueDate,
          supplier_or_payer: finalSupplierName || null,
          category: 'compra',
          alert_days_before: 3,
          notes,
        })
        .select('id')
        .single();
      if (aErr) throw new Error('Conta a pagar: ' + aErr.message);

      // 4) Audita import na nfe_imports
      await (supabase as any).from('nfe_imports').insert({
        tenant_id: tenantId,
        chave_nfe: extracted.chave_nfe || null,
        source_type: extracted.source_type || 'image',
        source_filename: sourceFilename || null,
        extracted_data: extracted,
        confidence: extracted.confidence || null,
        status: 'confirmed',
        apr_id: apr.id,
        supplier_id: finalSupplierId,
        stock_movement_ids: stockMovementIds,
      });

      toast.success(`✅ NF importada — ${stockMovementIds.length} entrada(s) de estoque + conta a pagar`);
      qc.invalidateQueries({ queryKey: ['ingredients', tenantId] });
      qc.invalidateQueries({ queryKey: ['stock_movements', tenantId] });
      qc.invalidateQueries({ queryKey: ['apr', tenantId] });
      qc.invalidateQueries({ queryKey: ['suppliers', tenantId] });
      onClose();
    } catch (e: any) {
      toast.error(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!extracted) return null;
  const conf = extracted.confidence || {};

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Revisar NF antes de salvar
          </DialogTitle>
        </DialogHeader>

        {duplicate && (
          <div className="rounded-md border border-amber-500 bg-amber-500/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>Esta NF já foi importada</strong> em {new Date(duplicate.created_at).toLocaleString('pt-BR')}.
              Confirme mesmo assim só se for outra entrada.
            </div>
          </div>
        )}

        <div className="rounded-md bg-muted/40 p-3 text-xs flex flex-wrap items-center gap-3">
          <Badge variant="outline">{extracted.source_type === 'xml' ? 'XML SEFAZ • 100% preciso' : extracted.source_type === 'pdf' ? 'PDF + IA' : 'Imagem + IA'}</Badge>
          {extracted.chave_nfe && <span className="font-mono text-[10px]">Chave: …{String(extracted.chave_nfe).slice(-12)}</span>}
        </div>

        {/* Cabeçalho NF */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Fornecedor</Label>
              <ConfBadge score={conf.supplier_name} />
            </div>
            <div className="flex gap-2">
              <Select value={supplierAction} onValueChange={(v: any) => setSupplierAction(v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="match">Existente</SelectItem>
                  <SelectItem value="create">Criar novo</SelectItem>
                  <SelectItem value="skip">Não vincular</SelectItem>
                </SelectContent>
              </Select>
              {supplierAction === 'match' ? (
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Escolha…" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : supplierAction === 'create' ? (
                <Input className="flex-1" value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="Nome do fornecedor" />
              ) : (
                <div className="flex-1 text-xs text-muted-foreground self-center">Pulando fornecedor</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between"><Label>Valor total</Label><ConfBadge score={conf.total} /></div>
              <Input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value)} />
            </div>
            <div>
              <div className="flex items-center justify-between"><Label>Vencimento</Label><ConfBadge score={conf.due_date} /></div>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Itens */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2"><Package className="h-4 w-4" />Itens ({summary.total})</Label>
            <div className="text-xs text-muted-foreground flex gap-2">
              <span className="text-primary">{summary.matched} vinculados</span>
              <span className="text-amber-600">{summary.created} novos</span>
              <span>{summary.skipped} ignorados</span>
            </div>
          </div>
          {rows.length === 0 && (
            <div className="text-sm text-muted-foreground p-3 border rounded">Nenhum item detectado (boleto/fatura). Só será criada a conta a pagar.</div>
          )}
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div key={idx} className="rounded-md border p-2 space-y-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.item.description || '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.item.quantity ?? '?'} {r.item.unit || ''} × {fmtBRL(r.item.unit_price)} = <strong>{fmtBRL(r.item.total)}</strong>
                    </div>
                  </div>
                  <Select value={r.action} onValueChange={(v: any) => updateRow(idx, { action: v })}>
                    <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="match">Vincular</SelectItem>
                      <SelectItem value="create">Criar novo</SelectItem>
                      <SelectItem value="skip">Ignorar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {r.action === 'match' && (
                  <Select value={r.ingredient_id || ''} onValueChange={(v) => updateRow(idx, { ingredient_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha o ingrediente…" /></SelectTrigger>
                    <SelectContent>
                      {ingredients.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {r.action === 'create' && (
                  <div className="grid grid-cols-[1fr_80px] gap-2">
                    <Input className="h-8 text-xs" value={r.new_name || ''} onChange={e => updateRow(idx, { new_name: e.target.value })} placeholder="Nome no estoque" />
                    <Input className="h-8 text-xs" value={r.new_unit || ''} onChange={e => updateRow(idx, { new_unit: e.target.value })} placeholder="un" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando…</> : <><Check className="h-4 w-4 mr-2" />Confirmar tudo</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
