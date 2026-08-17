import { useMemo, useState } from 'react';
import { useAcquirerReconciliations, useImportAcquirerCSV, useMatchAcquirer, useAPR, useUpsertAPR, useMarkPaidAPR, useDeleteAPR, useCashFlowProjection, useDREComparison } from '@/hooks/useFinanceDeep';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSubTabs } from '@/lib/admin-subtabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Upload, Plus, Check, X, Trash2, TrendingUp, TrendingDown, AlertCircle, Sparkles, FileScan } from 'lucide-react';
import { useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fileToScanPayload } from '@/lib/file-to-image';
import NfeReviewDialog from './NfeReviewDialog';

interface Props { tenantId: string }

const fmtBRL = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (s?: string | null) => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—';

function parseCSV(text: string): any[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  return lines.slice(1).map(l => {
    const vals = l.split(/[,;]/);
    const o: any = {};
    headers.forEach((h, i) => { o[h] = vals[i]?.trim(); });
    return o;
  });
}

// Validação amigável de cabeçalho — retorna erro legível em vez de deixar o erro cair no banco.
export function validateAcquirerCSVHeaders(rows: any[]): string | null {
  const required = ['transaction_date', 'authorization_code', 'nsu', 'card_brand', 'installments', 'gross_amount', 'fee_amount', 'net_amount', 'expected_settlement_date'];
  if (!rows.length) return 'O CSV está vazio (nenhuma linha de dados).';
  const row = rows[0];
  const missing = required.filter(k => !(k in row) || row[k] === '' || row[k] == null);
  if (missing.length) {
    const joined = missing.join(', ');
    // Detecta formato alternativo conhecido da maquininha para orientar o usuário.
    const sample = Object.keys(rows[Math.floor(rows.length / 2)] || row).join(', ');
    if (/date.*transaction|data.*transa|authorized_at|nsu/i.test(sample) && /gross|bruto|amount|valor/i.test(sample)) {
      return `Cabeçalho incompatível (faltam: ${joined}). Este parece ser um CSV de maquininha com nomes de colunas diferentes. Renomeie as colunas do arquivo para: ${required.join(', ')}.`;
    }
    return `Cabeçalho incompatível (faltam: ${joined}). Colunas esperadas: ${required.join(', ')}.`;
  }
  // Valida que os valores essenciais são preenchidos e numéricos
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.transaction_date || !r.nsu) return `Linha ${i + 2}: transaction_date ou nsu vazio — verifique se a exportação saiu completa.`;
    if (isNaN(Number(r.gross_amount)) || isNaN(Number(r.fee_amount)) || isNaN(Number(r.net_amount))) return `Linha ${i + 2}: valores monetários inválidos (gross/fee/net).`;
  }
  return null;
}

export default function TenantAdminFinanceDeep({ tenantId }: Props) {
  const subs = useSubTabs('finance-deep', [
    { id: 'acquirer', label: 'Adquirente' },
    { id: 'apr', label: 'Contas' },
    { id: 'cashflow', label: 'Fluxo Projetado' },
    { id: 'dre', label: 'DRE Comparativo' },
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Financeiro Avançado</h2>
        <p className="text-sm text-muted-foreground">Conciliação de adquirentes, contas a pagar/receber, fluxo projetado e DRE comparativo.</p>
      </div>
      <Tabs defaultValue={subs[0].id} className="w-full">
        <TabsList className="flex w-full overflow-x-auto justify-start h-auto gap-1">
          {subs.map(s => <TabsTrigger key={s.id} value={s.id} className="flex-shrink-0">{s.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="acquirer" className="mt-4"><AcquirerTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="apr" className="mt-4"><APRTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="cashflow" className="mt-4"><CashFlowTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="dre" className="mt-4"><DRETab tenantId={tenantId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============ Adquirente ============
function AcquirerTab({ tenantId }: { tenantId: string }) {
  const { data: rows = [], isLoading } = useAcquirerReconciliations(tenantId);
  const importMut = useImportAcquirerCSV(tenantId);
  const matchMut = useMatchAcquirer(tenantId);
  const [acquirer, setAcquirer] = useState('stone');
  const [filter, setFilter] = useState<string>('all');

  const filtered = useMemo(() => rows.filter(r => filter === 'all' || r.status === filter), [rows, filter]);
  const summary = useMemo(() => {
    const s = { gross: 0, fee: 0, net: 0, pending: 0, divergent: 0 };
    rows.forEach(r => { s.gross += +r.gross_amount; s.fee += +(r.fee_amount || 0); s.net += +r.net_amount;
      if (r.status === 'pending') s.pending++; if (r.status === 'divergent') s.divergent++; });
    return s;
  }, [rows]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) { toast.error('CSV vazio ou sem linhas de dados.'); return; }
    const headerError = validateAcquirerCSVHeaders(parsed);
    if (headerError) { toast.error(headerError); return; }
    try {
      await importMut.mutateAsync({ acquirer, rows: parsed });
      toast.success(`${parsed.length} lançamentos importados`);
    } catch (e: any) { toast.error('Erro ao importar: ' + e.message); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Importar CSV da adquirente</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Adquirente</Label>
              <Select value={acquirer} onValueChange={setAcquirer}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stone">Stone</SelectItem>
                  <SelectItem value="cielo">Cielo</SelectItem>
                  <SelectItem value="rede">Rede</SelectItem>
                  <SelectItem value="getnet">Getnet</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button asChild>
              <label className="cursor-pointer">
                <Upload className="h-4 w-4 mr-2" /> Enviar CSV
                <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Colunas esperadas: <code>transaction_date, authorization_code, nsu, card_brand, installments, gross_amount, fee_amount, net_amount, expected_settlement_date</code>
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Bruto</div><div className="text-lg font-semibold">{fmtBRL(summary.gross)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Taxas</div><div className="text-lg font-semibold text-destructive">{fmtBRL(summary.fee)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Líquido</div><div className="text-lg font-semibold text-primary">{fmtBRL(summary.net)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Pendentes</div><div className="text-lg font-semibold">{summary.pending}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="h-3 w-3" />Divergentes</div><div className="text-lg font-semibold text-destructive">{summary.divergent}</div></CardContent></Card>
      </div>

      <div className="flex gap-2">
        {(['all','pending','matched','divergent','settled'] as const).map(s => (
          <Button key={s} size="sm" variant={filter === s ? 'default' : 'outline'} onClick={() => setFilter(s)}>{s}</Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
          : filtered.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">Nenhum lançamento.</div>
          : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr><th className="text-left p-2">Data</th><th className="text-left p-2">Adq.</th><th className="text-left p-2">Bandeira</th><th className="text-right p-2">Bruto</th><th className="text-right p-2">Taxa</th><th className="text-right p-2">Líquido</th><th className="text-left p-2">Prev. liq.</th><th className="text-center p-2">Status</th><th className="text-center p-2">Ações</th></tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{fmtDate(r.transaction_date)}</td>
                    <td className="p-2">{r.acquirer}</td>
                    <td className="p-2">{r.card_brand || '—'} {r.installments && r.installments > 1 ? `${r.installments}x` : ''}</td>
                    <td className="p-2 text-right">{fmtBRL(+r.gross_amount)}</td>
                    <td className="p-2 text-right text-destructive">{fmtBRL(+(r.fee_amount || 0))}</td>
                    <td className="p-2 text-right font-medium">{fmtBRL(+r.net_amount)}</td>
                    <td className="p-2">{fmtDate(r.expected_settlement_date)}</td>
                    <td className="p-2 text-center">
                      <Badge variant={r.status === 'settled' ? 'default' : r.status === 'divergent' ? 'destructive' : 'secondary'}>{r.status}</Badge>
                    </td>
                    <td className="p-2 text-center">
                      <div className="flex gap-1 justify-center">
                        {r.status !== 'settled' && (
                          <Button size="icon" variant="ghost" title="Marcar liquidado" onClick={() => matchMut.mutate({ id: r.id, status: 'settled' })}><Check className="h-4 w-4" /></Button>
                        )}
                        {r.status !== 'divergent' && (
                          <Button size="icon" variant="ghost" title="Marcar divergente" onClick={() => matchMut.mutate({ id: r.id, status: 'divergent', reason: 'Marcado manualmente' })}><X className="h-4 w-4" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </CardContent>
      </Card>
    </div>
  );
}

// ============ Contas a pagar/receber ============
function APRTab({ tenantId }: { tenantId: string }) {
  const [kind, setKind] = useState<'payable' | 'receivable'>('payable');
  const { data: rows = [], isLoading } = useAPR(tenantId, kind);
  const upsert = useUpsertAPR(tenantId);
  const markPaid = useMarkPaidAPR(tenantId);
  const del = useDeleteAPR(tenantId);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<any>({ description: '', amount: '', due_date: '', category: '', supplier_or_payer: '', recurrence: '', alert_days_before: 3, document_number: '', notes: '' });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewData, setReviewData] = useState<{ extracted: any; duplicate: any; sourceFilename?: string } | null>(null);

  const handleScan = async (file: File) => {
    setScanning(true);
    try {
      const payload = await fileToScanPayload(file);
      const { data, error } = await supabase.functions.invoke('scan-invoice', {
        body: { tenant_id: tenantId, ...payload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const f = data?.extracted || {};
      const hasItems = Array.isArray(f.items) && f.items.length > 0;

      if (hasItems) {
        // NF com itens → abre tela de revisão com match de estoque + fornecedor
        setReviewData({ extracted: f, duplicate: data?.duplicate || null, sourceFilename: data?.source_filename });
        setReviewOpen(true);
        setOpen(false); // fecha o dialog simples
        toast.success(f.source_type === 'xml' ? '📄 XML lido (100% preciso) — revise os itens' : '📄 NF lida pela IA — revise os itens');
        return;
      }

      // Sem itens (boleto/fatura) → preenche form simples como antes
      if (data?.duplicate) toast.warning('⚠️ Esta NF já foi importada antes');
      setForm((prev: any) => ({
        ...prev,
        description: prev.description || (f.supplier_name ? `NF - ${f.supplier_name}` : ''),
        amount: f.total != null ? String(f.total) : prev.amount,
        due_date: f.due_date || prev.due_date,
        supplier_or_payer: f.supplier_name || prev.supplier_or_payer,
        document_number: f.chave_nfe || prev.document_number,
        notes: [
          f.supplier_cnpj ? `CNPJ: ${f.supplier_cnpj}` : null,
          f.chave_nfe ? `Chave: ${f.chave_nfe}` : null,
        ].filter(Boolean).join(' • ') || prev.notes,
      }));
      if (f.kind === 'receivable' || f.kind === 'payable') setKind(f.kind);
      toast.success('📄 Dados extraídos — confira e salve');
    } catch (e: any) {
      toast.error('Erro ao ler documento: ' + (e.message || e));
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };


  const submit = async () => {
    if (!form.description || !form.amount || !form.due_date) { toast.error('Preencha descrição, valor e vencimento'); return; }
    try {
      // document_number só existe no form (não no schema) — concatena nas notes
      const { document_number, notes, ...rest } = form;
      const mergedNotes = [document_number ? `Doc: ${document_number}` : null, notes || null].filter(Boolean).join(' • ') || null;
      await upsert.mutateAsync({ ...rest, notes: mergedNotes, kind, amount: Number(form.amount), alert_days_before: Number(form.alert_days_before || 3), recurrence: form.recurrence || null });
      toast.success('Lançamento salvo');
      setOpen(false);
      setForm({ description: '', amount: '', due_date: '', category: '', supplier_or_payer: '', recurrence: '', alert_days_before: 3, document_number: '', notes: '' });
    } catch (e: any) { toast.error(e.message); }
  };

  const today = new Date().toISOString().slice(0, 10);
  const total = rows.reduce((s, r) => s + (r.paid ? 0 : +r.amount), 0);
  const overdue = rows.filter(r => !r.paid && r.due_date < today);
  const dueSoon = rows.filter(r => !r.paid && r.due_date >= today && r.due_date <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          <Button variant={kind === 'payable' ? 'default' : 'outline'} onClick={() => setKind('payable')}>A Pagar</Button>
          <Button variant={kind === 'receivable' ? 'default' : 'outline'} onClick={() => setKind('receivable')}>A Receber</Button>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova conta {kind === 'payable' ? 'a pagar' : 'a receber'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {/* Upload + IA: lê NF/boleto/foto e preenche os campos */}
              <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf,.xml,text/xml,application/xml"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleScan(f); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-primary/50 text-primary hover:bg-primary/10"
                  onClick={() => fileRef.current?.click()}
                  disabled={scanning}
                >
                  {scanning ? (
                    <><Sparkles className="h-4 w-4 mr-2 animate-pulse" /> Lendo documento…</>
                  ) : (
                    <><FileScan className="h-4 w-4 mr-2" /> Anexar XML, PDF, foto ou imagem — IA preenche</>
                  )}
                </Button>
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                  XML da NF-e (preciso 100%), PDF, foto do boleto ou fatura. Detecta duplicidade pela chave.
                </p>
              </div>

              <div><Label>Descrição</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Valor</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Categoria</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Ex: aluguel, energia…" /></div>
                <div><Label>{kind === 'payable' ? 'Fornecedor' : 'Pagador'}</Label><Input value={form.supplier_or_payer} onChange={e => setForm({ ...form, supplier_or_payer: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Recorrência</Label>
                  <Select value={form.recurrence || 'none'} onValueChange={v => setForm({ ...form, recurrence: v === 'none' ? '' : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem recorrência</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="yearly">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Alertar (dias antes)</Label><Input type="number" value={form.alert_days_before} onChange={e => setForm({ ...form, alert_days_before: e.target.value })} /></div>
              </div>
              <Button onClick={submit} className="w-full">Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Em aberto</div><div className="text-lg font-semibold">{fmtBRL(total)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Vencidos</div><div className="text-lg font-semibold text-destructive">{overdue.length}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Vence em 7 dias</div><div className="text-lg font-semibold text-orange-500">{dueSoon.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
          : rows.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">Nada por aqui.</div>
          : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr><th className="text-left p-2">Vencimento</th><th className="text-left p-2">Descrição</th><th className="text-left p-2">{kind === 'payable' ? 'Fornecedor' : 'Pagador'}</th><th className="text-left p-2">Categoria</th><th className="text-right p-2">Valor</th><th className="text-center p-2">Status</th><th className="text-center p-2">Ações</th></tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isOverdue = !r.paid && r.due_date < today;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className={`p-2 ${isOverdue ? 'text-destructive font-medium' : ''}`}>{fmtDate(r.due_date)}</td>
                      <td className="p-2">{r.description}{r.recurrence ? <Badge variant="outline" className="ml-2 text-xs">{r.recurrence}</Badge> : null}</td>
                      <td className="p-2">{r.supplier_or_payer || '—'}</td>
                      <td className="p-2">{r.category || '—'}</td>
                      <td className="p-2 text-right font-medium">{fmtBRL(+r.amount)}</td>
                      <td className="p-2 text-center">
                        {r.paid ? <Badge>Pago</Badge> : isOverdue ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="secondary">Aberto</Badge>}
                      </td>
                      <td className="p-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <Button size="icon" variant="ghost" title={r.paid ? 'Desfazer' : 'Marcar pago'} onClick={() => markPaid.mutate({ id: r.id, paid: !r.paid })}><Check className={`h-4 w-4 ${r.paid ? 'text-primary' : ''}`} /></Button>
                          <Button size="icon" variant="ghost" title="Excluir" onClick={() => { if (confirm('Excluir?')) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
        </CardContent>
      </Card>

      <NfeReviewDialog
        tenantId={tenantId}
        open={reviewOpen}
        extracted={reviewData?.extracted || null}
        duplicate={reviewData?.duplicate || null}
        sourceFilename={reviewData?.sourceFilename}
        onClose={() => setReviewOpen(false)}
      />
    </div>
  );
}

// ============ Fluxo de caixa ============
function CashFlowTab({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState(30);
  const { data = [], isLoading } = useCashFlowProjection(tenantId, days);
  const total = useMemo(() => {
    const r = { in: 0, out: 0 };
    data.forEach(d => { r.in += +d.projected_in; r.out += +d.projected_out; });
    return r;
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[7, 15, 30, 60, 90].map(d => (
          <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>{d}d</Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3 text-primary" />Entradas</div><div className="text-lg font-semibold text-primary">{fmtBRL(total.in)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3 text-destructive" />Saídas</div><div className="text-lg font-semibold text-destructive">{fmtBRL(total.out)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Saldo projetado</div><div className={`text-lg font-semibold ${total.in - total.out >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmtBRL(total.in - total.out)}</div></CardContent></Card>
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
          : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr><th className="text-left p-2">Dia</th><th className="text-right p-2">Entradas</th><th className="text-right p-2">Saídas</th><th className="text-right p-2">Saldo</th><th className="text-right p-2">Acumulado</th></tr></thead>
              <tbody>
                {data.map(d => (
                  <tr key={d.d} className="border-t">
                    <td className="p-2">{fmtDate(d.d)}</td>
                    <td className="p-2 text-right text-primary">{fmtBRL(+d.projected_in)}</td>
                    <td className="p-2 text-right text-destructive">{fmtBRL(+d.projected_out)}</td>
                    <td className={`p-2 text-right ${+d.net >= 0 ? '' : 'text-destructive'}`}>{fmtBRL(+d.net)}</td>
                    <td className={`p-2 text-right font-medium ${+d.accumulated >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmtBRL(+d.accumulated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </CardContent>
      </Card>
    </div>
  );
}

// ============ DRE comparativo ============
function DRETab({ tenantId }: { tenantId: string }) {
  const [months, setMonths] = useState(6);
  const { data = [], isLoading } = useDREComparison(tenantId, months);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[3, 6, 12].map(m => (
          <Button key={m} size="sm" variant={months === m ? 'default' : 'outline'} onClick={() => setMonths(m)}>{m}m</Button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
          : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr><th className="text-left p-2">Mês</th><th className="text-right p-2">Receita</th><th className="text-right p-2">CMV</th><th className="text-right p-2">Taxa Plat.</th><th className="text-right p-2">Despesas</th><th className="text-right p-2">Lucro Líq.</th><th className="text-right p-2">Margem</th></tr></thead>
              <tbody>
                {data.map(d => {
                  const margin = +d.revenue > 0 ? ((+d.net_profit / +d.revenue) * 100) : 0;
                  return (
                    <tr key={d.month_start} className="border-t">
                      <td className="p-2 font-medium">{new Date(d.month_start + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</td>
                      <td className="p-2 text-right text-primary">{fmtBRL(+d.revenue)}</td>
                      <td className="p-2 text-right text-destructive">{fmtBRL(+d.cmv)}</td>
                      <td className="p-2 text-right text-destructive">{fmtBRL(+d.platform_fee)}</td>
                      <td className="p-2 text-right text-destructive">{fmtBRL(+d.expenses)}</td>
                      <td className={`p-2 text-right font-medium ${+d.net_profit >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmtBRL(+d.net_profit)}</td>
                      <td className={`p-2 text-right ${margin >= 0 ? '' : 'text-destructive'}`}>{margin.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
        </CardContent>
      </Card>
    </div>
  );
}
