/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, ClipboardList, History, LockKeyhole, Plus, ReceiptText, ShieldCheck, WalletCards } from 'lucide-react';

interface Props { tenantId: string }

type Scope = 'general' | 'product' | 'variant';
type AmountType = 'fixed_per_unit' | 'percentage_sale' | 'fixed_per_order';
type AmountKind = 'percentage' | 'fixed';
type SplitParticipant = { name: string; percent: number };
type SplitAllocation = { name: string; percent: number; amount: number };

type CatalogProduct = { id: string; name: string; price: number; original_price?: number | null };
type CatalogVariant = { id: string; product_id: string; name: string; price_delta?: number | null; cost_price?: number | null };
type CostRule = {
  id: string; scope: Scope; product_id: string | null; variant_id: string | null;
  category: string; label: string; amount_type: AmountType; amount: number; created_at: string;
};
type ProfitLine = {
  product_id: string | null; product_name: string; variant_id: string | null; variant_name: string;
  units: number; sale_unit_price: number; sales_total: number; product_cost_total: number;
  operating_cost_total: number; net_profit: number; owner_share: number; operator_share: number; split_allocations?: SplitAllocation[];
};
type Report = {
  period_start: string; period_end: string; owner_percent: number;
  summary: { units: number; sales_total: number; product_cost_total: number; operating_cost_total: number; net_profit: number; owner_share: number; operator_share: number; split_allocations?: SplitAllocation[] };
  split_allocations?: SplitAllocation[];
  lines: ProfitLine[];
};
type Settlement = {
  id: string; period_start: string; period_end: string; sales_total: number; product_cost_total: number;
  operating_cost_total: number; net_profit: number; owner_share: number; operator_share: number;
  status: 'open' | 'received'; snapshot: Report; created_at: string; received_at: string | null;
};

const money = (value: number | null | undefined) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoMonthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

const scopeLabel: Record<Scope, string> = { general: 'Geral', product: 'Produto', variant: 'Variação' };
const amountKindLabel: Record<AmountKind, string> = { percentage: 'Percentual (%)', fixed: 'Valor fixo (R$)' };
const amountTypeFor = (kind: AmountKind, scope: Scope): AmountType => kind === 'percentage'
  ? 'percentage_sale'
  : scope === 'general' ? 'fixed_per_order' : 'fixed_per_unit';
const amountKindFor = (amountType: AmountType): AmountKind => amountType === 'percentage_sale' ? 'percentage' : 'fixed';
const defaultSplit: SplitParticipant[] = [{ name: 'Plataforma', percent: 50 }, { name: 'Loja', percent: 50 }];

export default function TenantSocietyTab({ tenantId }: Props) {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<'report' | 'rules' | 'history'>('report');
  const [periodStart, setPeriodStart] = useState(isoMonthStart);
  const [periodEnd, setPeriodEnd] = useState(isoToday);
  const [selectedSettlement, setSelectedSettlement] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitParticipant[]>(defaultSplit);
  const [form, setForm] = useState({
    amountType: 'percentage_sale' as AmountType,
    label: '',
    scope: 'general' as Scope,
    productId: '',
    variantId: '',
    amount: '',
  });

  const { data: catalog = { products: [] as CatalogProduct[], variants: [] as CatalogVariant[] } } = useQuery({
    queryKey: ['society-catalog', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [{ data: productRows, error: productError }, { data: variantRows, error: variantError }] = await Promise.all([
        supabase.from('products').select('id,name,price,original_price').eq('tenant_id', tenantId).order('name').limit(1000),
        supabase.from('product_variants' as any).select('id,product_id,name,price_delta,cost_price').eq('tenant_id', tenantId).order('name').limit(2000),
      ]);
      if (productError) throw productError;
      if (variantError) throw variantError;
      return {
        products: (productRows || []) as CatalogProduct[],
        variants: (variantRows || []) as CatalogVariant[],
      };
    },
  });

  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['partnership-cost-rules', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('partnership_cost_rules' as any)
        .select('id,scope,product_id,variant_id,category,label,amount_type,amount,created_at')
        .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1000);
      if (error) throw error;
      return (data || []) as CostRule[];
    },
  });

  const splitConfigQuery = useQuery({
    queryKey: ['partnership-split-config', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_partnership_split_config', { _tenant_id: tenantId });
      if (error) throw error;
      return (data || defaultSplit) as SplitParticipant[];
    },
  });

  useEffect(() => {
    if (splitConfigQuery.data) setSplitDraft(splitConfigQuery.data.map(participant => ({ name: participant.name, percent: Number(participant.percent) || 0 })));
  }, [splitConfigQuery.data]);

  const reportQuery = useQuery({
    queryKey: ['partnership-profit-report', tenantId, periodStart, periodEnd],
    enabled: !!tenantId && !!periodStart && !!periodEnd && periodStart <= periodEnd,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_partnership_profit_report', {
        _tenant_id: tenantId, _period_start: periodStart, _period_end: periodEnd,
      });
      if (error) throw error;
      return data as Report;
    },
  });

  const { data: settlements = [], isLoading: settlementsLoading } = useQuery({
    queryKey: ['partnership-settlements', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('partnership_settlements' as any)
        .select('id,period_start,period_end,sales_total,product_cost_total,operating_cost_total,net_profit,owner_share,operator_share,status,snapshot,created_at,received_at')
        .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as Settlement[];
    },
  });

  const { data: isSuperAdmin = false } = useQuery({
    queryKey: ['society-super-admin'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data, error } = await supabase.from('platform_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').maybeSingle();
      return !error && !!data;
    },
  });

  const addRule = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount.replace(',', '.'));
      if (!form.label.trim()) throw new Error('Informe o nome do gasto.');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Informe um valor maior que zero.');
      if ((form.scope === 'product' || form.scope === 'variant') && !form.productId) throw new Error('Escolha o produto.');
      if (form.scope === 'variant' && !form.variantId) throw new Error('Escolha a variação.');
      const { error } = await supabase.from('partnership_cost_rules' as any).insert({
        tenant_id: tenantId,
        scope: form.scope,
        product_id: form.scope === 'general' ? null : form.productId || null,
        variant_id: form.scope === 'variant' ? form.variantId : null,
        category: 'personalizado',
        label: form.label.trim(),
        amount_type: form.amountType,
        amount,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Gasto adicionado ao histórico da sociedade.');
      setForm({ amountType: 'percentage_sale', label: '', scope: 'general', productId: '', variantId: '', amount: '' });
      qc.invalidateQueries({ queryKey: ['partnership-cost-rules', tenantId] });
      qc.invalidateQueries({ queryKey: ['partnership-profit-report', tenantId] });
    },
    onError: (error: any) => toast.error(error?.message || 'Não foi possível registrar o custo.'),
  });

  const saveSplit = useMutation({
    mutationFn: async () => {
      const participants = splitDraft.map(participant => ({ name: participant.name.trim(), percent: Number(participant.percent) || 0 }));
      if (participants.length < 2) throw new Error('Adicione pelo menos duas pessoas na divisão.');
      if (participants.some(participant => !participant.name)) throw new Error('Informe o nome de todas as pessoas.');
      if (participants.some(participant => participant.percent <= 0)) throw new Error('Cada percentual deve ser maior que zero.');
      const participantNames = participants.map(participant => participant.name.toLocaleLowerCase());
      if (new Set(participantNames).size !== participantNames.length) throw new Error('Use um nome diferente para cada pessoa.');
      const total = participants.reduce((sum, participant) => sum + participant.percent, 0);
      if (Math.abs(total - 100) > 0.01) throw new Error(`A soma dos percentuais deve ser 100%. Atualmente está em ${total.toFixed(2).replace('.', ',')}%.`);
      const { data, error } = await (supabase as any).rpc('save_partnership_split_config', { _tenant_id: tenantId, _participants: participants });
      if (error) throw error;
      return data as SplitParticipant[];
    },
    onSuccess: (data) => {
      setSplitDraft(data);
      toast.success('Divisão da sociedade atualizada.');
      qc.invalidateQueries({ queryKey: ['partnership-split-config', tenantId] });
      qc.invalidateQueries({ queryKey: ['partnership-profit-report', tenantId] });
    },
    onError: (error: any) => toast.error(error?.message || 'Não foi possível salvar a divisão.'),
  });

  const createSettlement = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc('create_partnership_settlement', {
        _tenant_id: tenantId, _period_start: periodStart, _period_end: periodEnd,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success('Fechamento oficial salvo com rastreabilidade.');
      setSelectedSettlement(id);
      qc.invalidateQueries({ queryKey: ['partnership-settlements', tenantId] });
    },
    onError: (error: any) => toast.error(error?.message?.includes('duplicate') ? 'Já existe um fechamento oficial para este período.' : (error?.message || 'Não foi possível fechar o período.')),
  });

  const receiveSettlement = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc('mark_partnership_settlement_received', { _settlement_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Repasse marcado como recebido pelo Super Admin.');
      qc.invalidateQueries({ queryKey: ['partnership-settlements', tenantId] });
    },
    onError: (error: any) => toast.error(error?.message || 'Somente o Super Admin pode marcar como recebido.'),
  });

  const variantsForProduct = useMemo(() => catalog.variants.filter(v => v.product_id === form.productId), [catalog.variants, form.productId]);
  const productName = (productId: string | null | undefined) => catalog.products.find(product => product.id === productId)?.name || 'Produto não encontrado';
  const variantName = (variantId: string | null) => catalog.variants.find(variant => variant.id === variantId)?.name || 'Variação não encontrada';
  const report = reportQuery.data;

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Sociedade — lucro líquido rastreável</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                O sistema usa o preço realmente vendido, o custo do produto/variação cadastrado e os gastos abaixo. O lucro líquido positivo é dividido entre as pessoas e percentuais configurados abaixo. Registros são históricos: para corrigir um gasto, lance uma nova regra.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={subTab} onValueChange={(value) => setSubTab(value as typeof subTab)}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="report" className="gap-1 text-xs sm:text-sm"><ClipboardList className="h-3.5 w-3.5" /> Apuração</TabsTrigger>
          <TabsTrigger value="rules" className="gap-1 text-xs sm:text-sm"><ReceiptText className="h-3.5 w-3.5" /> Gastos</TabsTrigger>
          <TabsTrigger value="history" className="gap-1 text-xs sm:text-sm"><History className="h-3.5 w-3.5" /> Fechamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Como dividir o lucro líquido</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Defina quantas pessoas participam e quanto cada uma recebe. A soma dos percentuais precisa ser exatamente 100%. Esta configuração vale para novas apurações; fechamentos oficiais antigos continuam com o snapshot original.</p>
              <div className="space-y-2">
                {splitDraft.map((participant, index) => <div key={`${index}-${participant.name}`} className="flex items-center gap-2"><Input value={participant.name} onChange={e => setSplitDraft(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item))} placeholder="Nome da pessoa" /><div className="relative w-28 shrink-0"><Input type="number" min="0.01" max="100" step="0.01" value={participant.percent || ''} onChange={e => setSplitDraft(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, percent: Number(e.target.value) } : item))} className="pr-7" /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">%</span></div><Button type="button" size="icon" variant="ghost" onClick={() => setSplitDraft(current => current.length > 2 ? current.filter((_, itemIndex) => itemIndex !== index) : current)} disabled={splitDraft.length <= 2} aria-label="Remover participante">×</Button></div>)}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSplitDraft(current => [...current, { name: `Pessoa ${current.length + 1}`, percent: 0 }])}><Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar pessoa</Button><span className={`text-xs font-medium ${Math.abs(splitDraft.reduce((sum, participant) => sum + (Number(participant.percent) || 0), 0) - 100) < 0.01 ? 'text-green-500' : 'text-destructive'}`}>Total: {splitDraft.reduce((sum, participant) => sum + (Number(participant.percent) || 0), 0).toFixed(2).replace('.', ',')}%</span><Button size="sm" onClick={() => saveSplit.mutate()} disabled={saveSplit.isPending || splitConfigQuery.isLoading}>{saveSplit.isPending ? 'Salvando...' : 'Salvar divisão'}</Button></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Período da apuração</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>De</Label><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></div>
                <div className="space-y-1"><Label>Até</Label><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <span>Considera somente pedidos entregues e não fiados.</span>
                <Button size="sm" onClick={() => createSettlement.mutate()} disabled={createSettlement.isPending || reportQuery.isLoading || !report}>
                  <LockKeyhole className="mr-1.5 h-3.5 w-3.5" /> {createSettlement.isPending ? 'Salvando...' : 'Gerar fechamento oficial'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {reportQuery.isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Calculando vendas, custos e divisão...</div>}
          {reportQuery.error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Não foi possível calcular este período. Confira as datas e tente novamente.</div>}
          {report && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric title="Vendas" value={money(report.summary.sales_total)} tone="text-foreground" />
                <Metric title="Custos totais" value={money(report.summary.product_cost_total + report.summary.operating_cost_total)} tone="text-red-400" />
                <Metric title="Lucro líquido" value={money(report.summary.net_profit)} tone={report.summary.net_profit >= 0 ? 'text-green-400' : 'text-red-400'} />
                {(report.summary.split_allocations || []).map(participant => <Metric key={participant.name} title={`${participant.name} (${Number(participant.percent).toFixed(2).replace('.', ',')}%)`} value={money(participant.amount)} tone="text-primary" />)}
              </div>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Resultado por produto e variação</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {report.lines.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma venda entregue no período.</p> : (
                    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs">
                      <thead className="bg-muted/50"><tr>
                        <th className="p-2 text-left">Produto / variação</th><th className="p-2 text-right">Qtd.</th><th className="p-2 text-right">Vendas</th><th className="p-2 text-right">Custo produto</th><th className="p-2 text-right">Gastos</th><th className="p-2 text-right">Lucro líquido</th><th className="p-2 text-right">Divisão</th>
                      </tr></thead>
                      <tbody>{report.lines.map((line, index) => <tr key={`${line.product_id || line.product_name}-${line.variant_id || index}`} className="border-t">
                        <td className="p-2"><div className="font-medium text-foreground">{line.product_name}</div><div className="text-muted-foreground">{line.variant_name || 'Base'} · preço médio {money(line.sale_unit_price)}</div></td>
                        <td className="p-2 text-right">{line.units}</td><td className="p-2 text-right">{money(line.sales_total)}</td><td className="p-2 text-right text-red-400">{money(line.product_cost_total)}</td><td className="p-2 text-right text-red-400">{money(line.operating_cost_total)}</td><td className={`p-2 text-right font-semibold ${line.net_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{money(line.net_profit)}</td><td className="p-2 text-right"><div className="space-y-1">{(line.split_allocations || []).map(participant => <div key={participant.name}><span className="text-muted-foreground">{participant.name}:</span> <strong>{money(participant.amount)}</strong></div>)}</div></td>
                      </tr>)}</tbody>
                    </table></div>
                  )}
                </CardContent>
              </Card>
              <p className="text-[11px] text-muted-foreground">Custo do produto vem de <code>cost_price</code> da variação; sem variação, usa <code>original_price</code> do produto. Gastos por pedido são rateados proporcionalmente ao valor de cada item.</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="rules" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4 text-primary" /> Adicionar gasto da sociedade</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1"><Label>1. Tipo do gasto</Label><select value={amountKindFor(form.amountType)} onChange={e => { const kind = e.target.value as AmountKind; setForm({ ...form, amountType: amountTypeFor(kind, form.scope) }); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="percentage">{amountKindLabel.percentage}</option><option value="fixed">{amountKindLabel.fixed}</option></select></div>
              <div className="space-y-1"><Label>2. Nome do gasto</Label><Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Taxa do checkout, motoboy, embalagem..." /></div>
              <div className="space-y-1"><Label>3. Onde esse gasto se aplica?</Label><select value={form.scope} onChange={e => { const scope = e.target.value as Scope; setForm({ ...form, scope, productId: '', variantId: '', amountType: amountTypeFor(amountKindFor(form.amountType), scope) }); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="general">Todas as vendas / gasto geral da loja</option><option value="product">Um produto específico</option><option value="variant">Uma variação específica</option></select></div>
              {form.scope !== 'general' && <div className="space-y-1"><Label>Produto</Label><select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value, variantId: '' })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Selecione um produto</option>{catalog.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
              {form.scope === 'variant' && <div className="space-y-1"><Label>Variação</Label><select value={form.variantId} onChange={e => setForm({ ...form, variantId: e.target.value })} disabled={!form.productId} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Selecione uma variação</option>{variantsForProduct.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>}
              <div className="space-y-1"><Label>Valor do gasto</Label><div className="flex gap-2"><div className="relative flex-1"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">{form.amountType === 'percentage_sale' ? '%' : 'R$'}</span><Input className="pl-9" type="text" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0,00" /></div><Button onClick={() => addRule.mutate()} disabled={addRule.isPending}>{addRule.isPending ? 'Adicionando...' : 'Adicionar gasto'}</Button></div></div>
              <p className="text-xs text-muted-foreground">Cadastre quantos gastos forem necessários, cada um com seu próprio nome. Para corrigir um gasto, faça um novo lançamento; os fechamentos antigos permanecem imutáveis.</p>
              <div className="flex items-start gap-2 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />O sistema calcula automaticamente se o valor fixo será aplicado por pedido ou por unidade, conforme o escopo escolhido.</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Histórico de gastos — somente inclusão</CardTitle></CardHeader>
            <CardContent>{rulesLoading ? <p className="py-4 text-center text-sm text-muted-foreground">Carregando...</p> : rules.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Nenhum gasto configurado.</p> : <div className="space-y-2">{rules.map(rule => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="font-medium text-sm text-foreground">{rule.label}</p><p className="text-[11px] text-muted-foreground">{rule.amount_type === 'percentage_sale' ? 'Percentual (%)' : 'Valor fixo (R$)'} · {scopeLabel[rule.scope]}{rule.scope === 'product' && rule.product_id ? ` · ${productName(rule.product_id)}` : ''}{rule.scope === 'variant' && rule.variant_id ? ` · ${productName(rule.product_id)} / ${variantName(rule.variant_id)}` : ''} · {dateBR(rule.created_at)}</p></div><span className="font-semibold text-red-400">{rule.amount_type === 'percentage_sale' ? `${Number(rule.amount).toFixed(2).replace('.', ',')}%` : money(rule.amount)}</span></div>)}</div>}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-3">
          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><WalletCards className="h-4 w-4 text-primary" /> Fechamentos oficiais</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">Cada fechamento guarda um snapshot dos produtos, variações, custos e divisão daquele período. Não há botão de apagar ou editar.</p></CardContent></Card>
          {settlementsLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Carregando histórico...</p> : settlements.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum fechamento oficial ainda.</p> : settlements.map(settlement => <Card key={settlement.id} className={selectedSettlement === settlement.id ? 'border-primary/60' : ''}><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-foreground">{dateBR(settlement.period_start)} a {dateBR(settlement.period_end)}</p><p className="text-[11px] text-muted-foreground">Criado em {new Date(settlement.created_at).toLocaleString('pt-BR')}</p></div><Badge variant={settlement.status === 'received' ? 'default' : 'secondary'}>{settlement.status === 'received' ? 'Recebido' : 'Aguardando recebimento'}</Badge></div><div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><div><span className="text-[11px] text-muted-foreground">Vendas</span><p className="font-semibold">{money(settlement.sales_total)}</p></div><div><span className="text-[11px] text-muted-foreground">Lucro líquido</span><p className={`font-semibold ${settlement.net_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{money(settlement.net_profit)}</p></div><div><span className="text-[11px] text-muted-foreground">Sua parte</span><p className="font-semibold text-primary">{money(settlement.owner_share)}</p></div><div><span className="text-[11px] text-muted-foreground">Parte da loja</span><p className="font-semibold">{money(settlement.operator_share)}</p></div></div>{(settlement.snapshot?.summary.split_allocations || []).length > 0 && <div className="flex flex-wrap gap-2 rounded-md bg-muted/40 p-2 text-xs">{(settlement.snapshot?.summary.split_allocations || []).map(participant => <span key={participant.name}><strong>{participant.name}</strong> ({Number(participant.percent).toFixed(2).replace('.', ',')}%): {money(participant.amount)}</span>)}</div>}<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedSettlement(selectedSettlement === settlement.id ? null : settlement.id)}>{selectedSettlement === settlement.id ? 'Ocultar snapshot' : 'Ver snapshot'}</Button>{settlement.status === 'open' && (isSuperAdmin ? <Button size="sm" onClick={() => receiveSettlement.mutate(settlement.id)} disabled={receiveSettlement.isPending}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Marcar como recebido</Button> : <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground"><LockKeyhole className="h-3 w-3" /> Só o Super Admin marca recebido</span>)}</div>{selectedSettlement === settlement.id && <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[700px] text-xs"><thead className="bg-muted/50"><tr><th className="p-2 text-left">Produto / variação</th><th className="p-2 text-right">Vendas</th><th className="p-2 text-right">Custos</th><th className="p-2 text-right">Lucro</th><th className="p-2 text-right">Divisão</th></tr></thead><tbody>{(settlement.snapshot?.lines || []).map((line, index) => <tr key={`${line.product_name}-${index}`} className="border-t"><td className="p-2">{line.product_name} · {line.variant_name}</td><td className="p-2 text-right">{money(line.sales_total)}</td><td className="p-2 text-right text-red-400">{money(line.product_cost_total + line.operating_cost_total)}</td><td className="p-2 text-right">{money(line.net_profit)}</td><td className="p-2 text-right"><div className="space-y-1">{(line.split_allocations || []).map(participant => <div key={participant.name}><span className="text-muted-foreground">{participant.name}:</span> {money(participant.amount)}</div>)}</div></td></tr>)}</tbody></table></div>}</CardContent></Card>)}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ title, value, tone }: { title: string; value: string; tone: string }) {
  return <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{title}</p><p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p></CardContent></Card>;
}
