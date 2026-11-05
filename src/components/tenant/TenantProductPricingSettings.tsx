/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Calculator, Check, Loader2, Plus, Save, Settings2, Trash2, Wallet } from 'lucide-react';
import { calculateConfiguredFinalProfit, type ConfiguredPricingConfig } from '@/lib/pricing';

type ExpenseRow = {
  id: string;
  label: string;
  amount_type: 'percentage' | 'fixed';
  amount: number;
  enabled: boolean;
  product_id: string | null;
};

type Props = { tenantId: string };

const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parseNumber = (value: string) => {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const TenantProductPricingSettings = ({ tenantId }: Props) => {
  const queryClient = useQueryClient();
  const [minimumProfit, setMinimumProfit] = useState('');
  const [sellerSharePercent, setSellerSharePercent] = useState('');
  const [newExpense, setNewExpense] = useState({ label: '', amountType: 'fixed' as 'fixed' | 'percentage', amount: '' });
  const [drafts, setDrafts] = useState<Record<string, { label: string; amountType: 'fixed' | 'percentage'; amount: string }>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingExpense, setSavingExpense] = useState<string | null>(null);

  const tenantQuery = useQuery({
    queryKey: ['tenant-catalog-pricing-settings', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants' as any)
        .select('id,catalog_minimum_profit,catalog_seller_share_percent')
        .eq('id', tenantId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const expensesQuery = useQuery({
    queryKey: ['tenant-catalog-pricing-expenses', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_pricer_expenses' as any)
        .select('id,label,amount_type,amount,enabled,product_id,created_at')
        .eq('tenant_id', tenantId)
        .is('product_id', null)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data || []) as ExpenseRow[];
    },
  });

  useEffect(() => {
    if (!tenantQuery.data) return;
    setMinimumProfit(String(Number(tenantQuery.data.catalog_minimum_profit ?? 0)));
    setSellerSharePercent(String(Number(tenantQuery.data.catalog_seller_share_percent ?? 0)));
  }, [tenantQuery.data]);

  useEffect(() => {
    if (!expensesQuery.data) return;
    setDrafts(Object.fromEntries(expensesQuery.data.map(expense => [expense.id, {
      label: expense.label,
      amountType: expense.amount_type === 'percentage' ? 'percentage' : 'fixed',
      amount: String(Number(expense.amount || 0)),
    }])));
  }, [expensesQuery.data]);

  const expenses = useMemo(() => expensesQuery.data || [], [expensesQuery.data]);
  const enabledExpenses = useMemo(() => expenses.filter(expense => expense.enabled), [expenses]);
  const previewConfig: ConfiguredPricingConfig = useMemo(() => ({
    minimumProfit: Math.max(0, parseNumber(minimumProfit)),
    sellerSharePercent: Math.min(100, Math.max(0, parseNumber(sellerSharePercent))),
    expenses: enabledExpenses.map(expense => ({
      amountType: expense.amount_type === 'percentage' ? 'percentage' : 'fixed',
      amount: Number(expense.amount || 0),
      enabled: true,
    })),
  }), [enabledExpenses, minimumProfit, sellerSharePercent]);
  const preview = calculateConfiguredFinalProfit(1000, 700, previewConfig);

  const saveSettings = async () => {
    const minimum = parseNumber(minimumProfit);
    const seller = parseNumber(sellerSharePercent);
    if (minimum < 0) return toast.error('O lucro mínimo não pode ser negativo.');
    if (seller < 0 || seller > 100) return toast.error('A comissão deve ficar entre 0% e 100%.');
    setSavingSettings(true);
    const { error } = await supabase.from('tenants' as any).update({
      catalog_minimum_profit: minimum,
      catalog_seller_share_percent: seller,
      updated_at: new Date().toISOString(),
    }).eq('id', tenantId);
    setSavingSettings(false);
    if (error) return toast.error(`Não foi possível salvar a política: ${error.message}`);
    await Promise.all([
      tenantQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['tenant-catalog-pricing-config', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['tenant-catalog-pricing-settings', tenantId] }),
    ]);
    toast.success('Política de disponibilidade salva para esta loja.');
  };

  const addExpense = async () => {
    const amount = parseNumber(newExpense.amount);
    if (!newExpense.label.trim()) return toast.error('Informe o nome do gasto.');
    if (amount < 0) return toast.error('O gasto não pode ser negativo.');
    setSavingExpense('new');
    const { error } = await supabase.from('market_pricer_expenses' as any).insert({
      tenant_id: tenantId,
      label: newExpense.label.trim(),
      amount_type: newExpense.amountType,
      amount,
      enabled: true,
      product_id: null,
    });
    setSavingExpense(null);
    if (error) return toast.error(`Não foi possível adicionar o gasto: ${error.message}`);
    setNewExpense({ label: '', amountType: 'fixed', amount: '' });
    await Promise.all([
      expensesQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['tenant-catalog-pricing-config', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['market-pricer-expenses', tenantId] }),
    ]);
    toast.success('Gasto adicionado e aplicado ao cálculo desta loja.');
  };

  const saveExpense = async (expense: ExpenseRow) => {
    const draft = drafts[expense.id];
    if (!draft?.label.trim()) return toast.error('O nome do gasto não pode ficar vazio.');
    const amount = parseNumber(draft.amount);
    if (amount < 0) return toast.error('O gasto não pode ser negativo.');
    setSavingExpense(expense.id);
    const { error } = await supabase.from('market_pricer_expenses' as any).update({
      label: draft.label.trim(),
      amount_type: draft.amountType,
      amount,
    }).eq('id', expense.id).eq('tenant_id', tenantId);
    setSavingExpense(null);
    if (error) return toast.error(`Não foi possível atualizar o gasto: ${error.message}`);
    await Promise.all([
      expensesQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['tenant-catalog-pricing-config', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['market-pricer-expenses', tenantId] }),
    ]);
    toast.success('Gasto atualizado.');
  };

  const toggleExpense = async (expense: ExpenseRow) => {
    const { error } = await supabase.from('market_pricer_expenses' as any).update({ enabled: !expense.enabled }).eq('id', expense.id).eq('tenant_id', tenantId);
    if (error) return toast.error(`Não foi possível alterar o gasto: ${error.message}`);
    await Promise.all([
      expensesQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['tenant-catalog-pricing-config', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['market-pricer-expenses', tenantId] }),
    ]);
  };

  const removeExpense = async (expense: ExpenseRow) => {
    if (!window.confirm(`Remover “${expense.label}” do cálculo desta loja?`)) return;
    const { error } = await supabase.from('market_pricer_expenses' as any).delete().eq('id', expense.id).eq('tenant_id', tenantId);
    if (error) return toast.error(`Não foi possível remover o gasto: ${error.message}`);
    await Promise.all([
      expensesQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['tenant-catalog-pricing-config', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['market-pricer-expenses', tenantId] }),
    ]);
    toast.success('Gasto removido do cálculo.');
  };

  if (tenantQuery.isLoading || expensesQuery.isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/25 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-primary" /> Política de disponibilidade desta loja</CardTitle>
          <p className="text-xs text-muted-foreground">O catálogo calcula o lucro líquido com os gastos ativos abaixo. Se o lucro ficar abaixo do mínimo configurado, o produto ou variação fica indisponível por prejuízo. A regra é exclusiva desta loja.</p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5"><Label htmlFor="catalog-min-profit">Lucro líquido mínimo para liberar</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">R$</span><Input id="catalog-min-profit" value={minimumProfit} onChange={e => setMinimumProfit(e.target.value)} inputMode="decimal" className="pl-9" placeholder="0,00" /></div><p className="text-[11px] text-muted-foreground">Considerado depois dos gastos e da comissão.</p></div>
          <div className="space-y-1.5"><Label htmlFor="catalog-seller-share">Comissão do vendedor</Label><div className="relative"><Input id="catalog-seller-share" value={sellerSharePercent} onChange={e => setSellerSharePercent(e.target.value)} inputMode="decimal" className="pr-8" placeholder="0,00" /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">%</span></div><p className="text-[11px] text-muted-foreground">Aplicada sobre o lucro positivo antes da comissão.</p></div>
          <Button onClick={saveSettings} disabled={savingSettings} className="gap-2"><Save className="h-4 w-4" /> {savingSettings ? 'Salvando...' : 'Salvar política'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-primary" /> Gastos usados no cálculo</CardTitle><p className="text-xs text-muted-foreground">Gastos fixos são descontados em reais. Gastos percentuais são calculados sobre o preço de venda. Desative um item para não usá-lo sem apagar o cadastro.</p></CardHeader>
        <CardContent className="space-y-3">
          {expenses.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nenhum gasto cadastrado.</p>}
          {expenses.map(expense => {
            const draft = drafts[expense.id] || { label: expense.label, amountType: expense.amount_type === 'percentage' ? 'percentage' as const : 'fixed' as const, amount: String(Number(expense.amount || 0)) };
            return <div key={expense.id} className={`grid gap-2 rounded-xl border p-3 md:grid-cols-[minmax(180px,1fr)_150px_115px_auto_auto] md:items-end ${expense.enabled ? 'border-border bg-card' : 'border-border/60 bg-muted/30 opacity-70'}`}>
              <div className="space-y-1"><Label className="text-[11px]">Nome do gasto</Label><Input value={draft.label} onChange={e => setDrafts(current => ({ ...current, [expense.id]: { ...draft, label: e.target.value } }))} /></div>
              <div className="space-y-1"><Label className="text-[11px]">Tipo</Label><select value={draft.amountType} onChange={e => setDrafts(current => ({ ...current, [expense.id]: { ...draft, amountType: e.target.value as 'fixed' | 'percentage' } }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="fixed">Valor fixo (R$)</option><option value="percentage">Percentual (%)</option></select></div>
              <div className="space-y-1"><Label className="text-[11px]">Valor</Label><Input value={draft.amount} onChange={e => setDrafts(current => ({ ...current, [expense.id]: { ...draft, amount: e.target.value } }))} inputMode="decimal" /></div>
              <Button variant="outline" onClick={() => saveExpense(expense)} disabled={savingExpense === expense.id} className="gap-1.5"><Check className="h-4 w-4" /> Salvar</Button>
              <div className="flex gap-2"><Button variant="secondary" onClick={() => toggleExpense(expense)}>{expense.enabled ? 'Desativar' : 'Ativar'}</Button><Button variant="ghost" onClick={() => removeExpense(expense)} className="px-2 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></div>
            </div>;
          })}
          <div className="grid gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 md:grid-cols-[minmax(180px,1fr)_150px_115px_auto] md:items-end">
            <div className="space-y-1"><Label className="text-[11px]">Novo gasto</Label><Input value={newExpense.label} onChange={e => setNewExpense(current => ({ ...current, label: e.target.value }))} placeholder="Ex.: embalagem" /></div>
            <div className="space-y-1"><Label className="text-[11px]">Tipo</Label><select value={newExpense.amountType} onChange={e => setNewExpense(current => ({ ...current, amountType: e.target.value as 'fixed' | 'percentage' }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"><option value="fixed">Valor fixo (R$)</option><option value="percentage">Percentual (%)</option></select></div>
            <div className="space-y-1"><Label className="text-[11px]">Valor</Label><Input value={newExpense.amount} onChange={e => setNewExpense(current => ({ ...current, amount: e.target.value }))} inputMode="decimal" placeholder="0,00" /></div>
            <Button onClick={addExpense} disabled={savingExpense === 'new'} className="gap-2"><Plus className="h-4 w-4" /> Adicionar gasto</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[auto_1fr] md:items-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Calculator className="h-5 w-5" /></div>
          <div><p className="text-sm font-semibold text-foreground">Exemplo atualizado em tempo real</p><p className="text-xs text-muted-foreground">Para um produto vendido por R$ 1.000,00 com custo de R$ 700,00, o lucro calculado é <strong className={preview.finalProfit >= previewConfig.minimumProfit ? 'text-green-600 dark:text-green-400' : 'text-destructive'}>{money(preview.finalProfit)}</strong>. Mínimo configurado: {money(previewConfig.minimumProfit)} · Resultado: <strong>{preview.finalProfit >= previewConfig.minimumProfit ? 'disponível' : 'bloqueado por prejuízo/margem insuficiente'}</strong>.</p></div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TenantProductPricingSettings;
