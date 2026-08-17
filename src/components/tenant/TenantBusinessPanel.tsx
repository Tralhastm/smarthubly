// Painel Empresarial nativo — substitui a integracao com FinanceFlow externo.
// Modo VISUALIZACAO apenas: le orders, financial_entries (despesas), credit_accounts,
// products. Nao permite lancar nada (lancamentos sao no painel principal).
// 2 sub-abas: Resumo (visao rapida) e Financeiro (detalhe contabil).

import { useState, useMemo, useEffect } from 'react';
import { useOrders } from '@/hooks/useOrders';
import { useFinancialEntries, useDebts, useAddFinancialEntry, useAddDebt, useUpdateDebt } from '@/hooks/useFinancial';
import { useProducts } from '@/hooks/useProducts';
import { useCreditAccounts, useAddCreditAccount, useAddCreditPayment, useSendCreditReminder, type CreditAccount } from '@/hooks/useCredit';
import { supabase } from '@/integrations/supabase/client';
import { normalizePaymentMethod, formatPaymentMethodLabel } from '@/lib/payment-method';
import {
  BarChart3, Briefcase, Bot, RefreshCw, Sparkles, Loader2,
  CheckCircle2, AlertTriangle, AlertCircle, Lightbulb, MessageCircle, Zap,
  Plus, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import ClaraChat from './ClaraChat';

type SubTab = 'resumo' | 'financeiro';
type FinSubTab = 'completo' | 'despesas' | 'fiado' | 'fornecedores';

type Insight = { type: 'success' | 'warning' | 'danger' | 'tip'; title: string; text: string };

const INSIGHT_STYLE: Record<Insight['type'], { bar: string; icon: JSX.Element }> = {
  success: { bar: 'border-l-green-500', icon: <CheckCircle2 className="h-4 w-4 text-green-400" /> },
  warning: { bar: 'border-l-yellow-500', icon: <AlertTriangle className="h-4 w-4 text-yellow-400" /> },
  danger:  { bar: 'border-l-red-500', icon: <AlertCircle className="h-4 w-4 text-red-400" /> },
  tip:     { bar: 'border-l-primary', icon: <Lightbulb className="h-4 w-4 text-primary" /> },
};

const fmt = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;
const entryOptions = [
  { value: 'inventory', label: 'Compra de estoque', type: 'expense', group: 'variable' },
  { value: 'rent', label: 'Aluguel', type: 'expense', group: 'fixed' },
  { value: 'utilities', label: 'Luz / Água / Net', type: 'expense', group: 'fixed' },
  { value: 'salaries', label: 'Salário / Pró-labore', type: 'expense', group: 'fixed' },
  { value: 'marketing', label: 'Marketing / Anúncio', type: 'expense', group: 'variable' },
  { value: 'maintenance', label: 'Manutenção / Conserto', type: 'expense', group: 'unexpected' },
  { value: 'other_out', label: 'Outra saída', type: 'expense', group: 'variable' },
  { value: 'sales', label: 'Venda avulsa', type: 'income', group: 'venda' },
  { value: 'other_in', label: 'Outra entrada', type: 'income', group: 'variable' },
] as const;
type EntryOptionValue = typeof entryOptions[number]['value'];

const emptyEntryForm = { category: 'inventory' as EntryOptionValue, amount: '', description: '', isCreditCard: false, dueDate: '' };
const emptyCreditForm = { customer_name: '', customer_phone: '', customer_email: '', amount: '', description: '', due_date: '', notes: '' };
const emptyDebtForm = { name: '', amount: '', dueDate: '', type: 'payable' as 'payable' | 'receivable' };

const TenantBusinessPanel = ({
  tenantId,
  tenantName,
  onOpenClara,
}: {
  tenantId: string;
  tenantName?: string;
  onOpenClara?: () => void;
}) => {
  const [tab, setTab] = useState<SubTab>('resumo');
  const [finTab, setFinTab] = useState<FinSubTab>('completo');
  const [claraOpen, setClaraOpen] = useState(false);
  const openClara = () => (onOpenClara ? onOpenClara() : setClaraOpen(true));

  // Permite que a Sofia (ou qualquer outro componente) peça pra abrir a Clara
  // disparando window.dispatchEvent(new CustomEvent('clara:open-request')).
  useEffect(() => {
    const handler = () => setClaraOpen(true);
    window.addEventListener('clara:open-request', handler);
    return () => window.removeEventListener('clara:open-request', handler);
  }, []);

  const { data: orders = [] } = useOrders(tenantId);
  const { data: entries = [] } = useFinancialEntries(tenantId);
  const { data: products = [] } = useProducts(tenantId);
  const { data: credits = [] } = useCreditAccounts(tenantId);
  const { data: debts = [] } = useDebts(tenantId);
  const addEntry = useAddFinancialEntry();
  const addCredit = useAddCreditAccount();
  const addCreditPay = useAddCreditPayment();
  const sendReminder = useSendCreditReminder();
  const addDebt = useAddDebt();
  const updateDebt = useUpdateDebt();
  const [quickEntry, setQuickEntry] = useState(emptyEntryForm);
  const [quickCredit, setQuickCredit] = useState(emptyCreditForm);
  const [quickDebt, setQuickDebt] = useState(emptyDebtForm);
  const [payingCreditId, setPayingCreditId] = useState<string | null>(null);
  const [payCreditAmount, setPayCreditAmount] = useState('');
  const [remindingCreditId, setRemindingCreditId] = useState<string | null>(null);

  // Total que devo a fornecedores: dívidas manuais com prefixo 🏭 (não pagas)
  const supplierDebtTotal = debts
    .filter((d: any) => !d.paid && (d.type === 'owe' || d.type === 'payable') && typeof d.name === 'string' && d.name.startsWith('🏭'))
    .reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  // ============ FONTE UNICA DE VERDADE ============
  // Vendas = orders delivered (sem fiado). Fiado vira receita quando o cliente paga
  // (entry manual ou conversao da credit_account).
  const isFiado = (o: any) => (o.payment_method || '').toLowerCase() === 'fiado';
  const realized = orders.filter(o => o.status === 'delivered' && !isFiado(o));

  // Despesas = SOMENTE financial_entries do tipo expense. Entries do tipo income
  // sao IGNORADAS aqui (vendas ja vem dos orders — evita dupla contagem do bug
  // R$50,42 → R$100,84 que ocorria no painel antigo).
  const expenseEntries = entries.filter(e => e.type === 'expense');
  const isPendingCardExpense = (e: any) => e.type === 'expense' && e.is_credit_card === true && e.paid === false;

  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(now);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // ===== HOJE =====
  const todayOrders = realized.filter(o => new Date(o.created_at) >= today);
  const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const todayTicket = todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0;

  // ===== MES ATUAL =====
  const monthOrders = realized.filter(o => new Date(o.created_at) >= startOfMonth);
  const monthRevenue = monthOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const monthExpenses = expenseEntries
    .filter(e => new Date(e.date) >= startOfMonth)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthCashExpenses = expenseEntries
    .filter(e => new Date(e.date) >= startOfMonth && !isPendingCardExpense(e))
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthCardPending = expenseEntries
    .filter(e => new Date(e.date) >= startOfMonth && isPendingCardExpense(e))
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthProfit = monthRevenue - monthExpenses;
  const monthMargin = monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0;

  // ===== MES ANTERIOR (comparativo) =====
  const prevMonthRev = realized
    .filter(o => {
      const d = new Date(o.created_at);
      return d >= startOfPrevMonth && d < startOfMonth;
    })
    .reduce((s, o) => s + Number(o.total || 0), 0);
  const monthDelta = prevMonthRev > 0 ? ((monthRevenue - prevMonthRev) / prevMonthRev) * 100 : 0;

  // ===== ENTRADAS POR METODO DE PAGAMENTO (mes atual) =====
  const monthIncomeByMethod = useMemo(() => {
    const map: Record<string, number> = {};
    monthOrders.forEach(o => {
      const key = normalizePaymentMethod(o.payment_method);
      const label = formatPaymentMethodLabel(key);
      map[label] = (map[label] || 0) + Number(o.total || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [monthOrders]);

  // ===== SAIDAS POR CATEGORIA (mes atual) =====
  const monthExpenseByCat = useMemo(() => {
    const map: Record<string, number> = {};
    expenseEntries
      .filter(e => new Date(e.date) >= startOfMonth)
      .forEach(e => {
        const k = e.category || 'outro';
        map[k] = (map[k] || 0) + Number(e.amount || 0);
      });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [expenseEntries, startOfMonth]);

  const fixedGroups = new Set(['fixed', 'taxa_plataforma']);
  const monthFixedExp = expenseEntries
    .filter(e => new Date(e.date) >= startOfMonth && fixedGroups.has(e.category || ''))
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthVarExp = monthExpenses - monthFixedExp;

  const biggestFixed = useMemo(() => {
    const arr = expenseEntries.filter(e => new Date(e.date) >= startOfMonth && fixedGroups.has(e.category || ''));
    return arr.sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
  }, [expenseEntries, startOfMonth]);

  const biggestVar = useMemo(() => {
    const arr = expenseEntries.filter(e => new Date(e.date) >= startOfMonth && !fixedGroups.has(e.category || ''));
    return arr.sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
  }, [expenseEntries, startOfMonth]);

  // ===== TOP PRODUTO DO MES =====
  const topProduct = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; qty: number }> = {};
    monthOrders.forEach((o: any) => {
      (o.order_items || []).forEach((it: any) => {
        const k = it.product_name;
        if (!map[k]) map[k] = { name: k, revenue: 0, qty: 0 };
        map[k].revenue += Number(it.product_price) * Number(it.quantity);
        map[k].qty += Number(it.quantity);
      });
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue)[0] || null;
  }, [monthOrders]);

  // ===== FIADO =====
  const fiadoOpen = credits
    .filter(c => c.status === 'open' || c.status === 'overdue')
    .reduce((s, c) => s + (Number(c.amount) - Number(c.amount_paid)), 0);

  // ===== ESTOQUE =====
  const lowStock = products.filter((p: any) => p.stock_quantity != null && p.stock_quantity > 0 && p.stock_quantity <= 5);
  const outOfStock = products.filter((p: any) => p.stock_quantity != null && p.stock_quantity === 0).length;

  // ===== PEDIDOS PENDENTES (a receber) =====
  const pendingOrders = orders.filter(o => !['delivered', 'cancelled', 'pending_payment'].includes(o.status) && !isFiado(o));
  const pendingRevenue = pendingOrders.reduce((s, o) => s + Number(o.total || 0), 0);

  // ===== SALDO =====
  const cashBalance = monthRevenue - monthCashExpenses;
  const availableBalance = cashBalance - monthCardPending;
  const futureBalance = availableBalance + fiadoOpen + pendingRevenue;

  // ===== HISTORICO 6 MESES =====
  const last6Months = useMemo(() => {
    const arr: { key: string; label: string; revenue: number; expenses: number; profit: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
      const fullKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const rev = realized.filter(o => {
        const od = new Date(o.created_at);
        return od >= d && od < next;
      }).reduce((s, o) => s + Number(o.total || 0), 0);
      const exp = expenseEntries.filter(e => {
        const ed = new Date(e.date);
        return ed >= d && ed < next;
      }).reduce((s, e) => s + Number(e.amount || 0), 0);
      arr.push({ key: fullKey, label: key, revenue: rev, expenses: exp, profit: rev - exp });
    }
    return arr;
  }, [realized, expenseEntries, now.getMonth(), now.getFullYear()]);

  const max6 = Math.max(...last6Months.map(m => m.revenue), 1);

  // ============ INSIGHTS DA IA ============
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsLoaded, setInsightsLoaded] = useState(false);

  const submitQuickEntry = async () => {
    const opt = entryOptions.find(o => o.value === quickEntry.category) || entryOptions[0];
    const amount = Number(quickEntry.amount);
    if (!amount || amount <= 0) return toast.error('Informe o valor');
    const onCard = opt.type === 'expense' && quickEntry.isCreditCard;
    try {
      await addEntry.mutateAsync({
        tenant_id: tenantId,
        type: opt.type,
        amount,
        description: quickEntry.description.trim() || opt.label,
        category: opt.group,
        subcategory: opt.value,
        is_credit_card: onCard,
        paid: !onCard,
        paid_at: onCard ? null : new Date().toISOString(),
        due_date: onCard && quickEntry.dueDate ? new Date(quickEntry.dueDate + 'T12:00:00').toISOString() : null,
        date: new Date().toISOString(),
      } as any);
      toast.success(opt.type === 'income' ? 'Entrada lançada' : 'Despesa lançada');
      setQuickEntry(emptyEntryForm);
    } catch (e: any) { toast.error(e?.message || 'Erro ao lançar'); }
  };

  const submitQuickCredit = async () => {
    const amount = Number(quickCredit.amount);
    if (!quickCredit.customer_name.trim()) return toast.error('Nome do cliente obrigatório');
    if (!amount || amount <= 0) return toast.error('Valor inválido');
    if (!quickCredit.due_date) return toast.error('Vencimento obrigatório');
    try {
      await addCredit.mutateAsync({
        tenant_id: tenantId,
        customer_name: quickCredit.customer_name.trim(),
        customer_phone: quickCredit.customer_phone.trim(),
        customer_email: quickCredit.customer_email.trim(),
        amount,
        description: quickCredit.description.trim(),
        due_date: new Date(quickCredit.due_date + 'T23:59:59').toISOString(),
        notes: quickCredit.notes.trim(),
      });
      toast.success('Fiado lançado');
      setQuickCredit(emptyCreditForm);
    } catch (e: any) { toast.error(e?.message || 'Erro ao lançar fiado'); }
  };

  const receiveCredit = async (acc: CreditAccount) => {
    const amount = Number(payCreditAmount);
    const remaining = Number(acc.amount) - Number(acc.amount_paid);
    if (!amount || amount <= 0) return toast.error('Valor inválido');
    if (amount > remaining + 0.01) return toast.error('Valor maior que o devido');
    try {
      await addCreditPay.mutateAsync({ accountId: acc.id, tenantId, amount, note: '', currentPaid: Number(acc.amount_paid), totalAmount: Number(acc.amount) });
      await addEntry.mutateAsync({
        tenant_id: tenantId,
        type: 'income',
        amount,
        description: `Recebimento fiado — ${acc.customer_name}`,
        category: 'variable',
        subcategory: 'other_in',
        paid: true,
        paid_at: new Date().toISOString(),
        date: new Date().toISOString(),
      } as any);
      toast.success(amount >= remaining ? 'Fiado quitado e entrada lançada' : 'Pagamento parcial lançado');
      setPayingCreditId(null);
      setPayCreditAmount('');
    } catch (e: any) { toast.error(e?.message || 'Erro ao receber'); }
  };

  const submitQuickDebt = async () => {
    const amount = Number(quickDebt.amount);
    if (!quickDebt.name.trim() || !amount || amount <= 0) return toast.error('Preencha nome e valor');
    try {
      await addDebt.mutateAsync({
        tenant_id: tenantId,
        name: quickDebt.name.trim(),
        amount,
        due_date: quickDebt.dueDate || null,
        paid: false,
        type: quickDebt.type === 'payable' ? 'owe' : 'owed',
      } as any);
      toast.success(quickDebt.type === 'payable' ? 'Conta a pagar lançada' : 'Cobrança lançada');
      setQuickDebt(emptyDebtForm);
    } catch (e: any) { toast.error(e?.message || 'Erro ao lançar cobrança'); }
  };

  const fetchInsights = async () => {
    setInsightsLoading(true);
    try {
      const snapshot = {
        storeName: tenantName,
        todaySales: Number(todayRevenue.toFixed(2)),
        todayCount: todayOrders.length,
        monthRevenue: Number(monthRevenue.toFixed(2)),
        monthExpenses: Number(monthExpenses.toFixed(2)),
        productsCount: products.length,
        lowStockProducts: lowStock.slice(0, 8).map((p: any) => p.name),
        outOfStockCount: outOfStock,
        fiadoOpen: Number(fiadoOpen.toFixed(2)),
        pendingOrdersValue: Number(pendingRevenue.toFixed(2)),
        cashOpen: todayOrders.length > 0,
        topProductMonth: topProduct?.name ?? null,
        margin: Number(monthMargin.toFixed(1)),
      };
      const { data, error } = await supabase.functions.invoke('empresarial-insights', { body: snapshot });
      // supabase.functions.invoke devolve erro em `error` quando status nao-2xx,
      // mas o body com a mensagem amigavel vem em `error.context` (Response).
      if (error) {
        let friendly = 'Não consegui gerar os insights agora.';
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.message) friendly = body.message;
            if (body?.error === 'no_credits') friendly = '🤖 Sem créditos de IA agora. Avise o admin pra recarregar.';
            if (body?.error === 'rate_limited') friendly = '⏱️ Muitas requisições. Tente em alguns segundos.';
          }
        } catch { /* noop */ }
        toast.error(friendly);
        return;
      }
      if ((data as any)?.error) {
        toast.error((data as any)?.message || 'Erro ao gerar insights');
        return;
      }
      setInsights((data as any)?.insights || []);
      setInsightsLoaded(true);
    } catch (e: any) {
      toast.error(e?.message || 'Não consegui gerar os insights agora');
    } finally {
      setInsightsLoading(false);
    }
  };

  // ============ RENDER ============
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <p className="text-sm text-foreground leading-relaxed">
          <span className="inline-flex items-center gap-1 font-semibold">
            <Zap className="h-4 w-4 text-primary" /> Empresarial operacional
          </span>
          {' — '}
          acompanhe os números e faça lançamentos financeiros, fiado e cobranças no mesmo painel.
        </p>
      </div>

      {/* Sub-abas — pill segmentado */}
      <div className="inline-flex w-full rounded-xl bg-secondary/60 p-1">
        <button
          onClick={() => setTab('resumo')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
            tab === 'resumo' ? 'gradient-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <BarChart3 className="h-4 w-4" /> Resumo
        </button>
        <button
          onClick={() => setTab('financeiro')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
            tab === 'financeiro' ? 'gradient-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Briefcase className="h-4 w-4" /> Financeiro
        </button>
      </div>

      {/* ============ ABA RESUMO ============ */}
      {tab === 'resumo' && (
        <div className="space-y-4 animate-fade-in">
          {/* Cards principais */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wide text-primary/80 font-medium">Vendas hoje</p>
              <p className="text-2xl font-bold text-foreground mt-1">{fmt(todayRevenue)}</p>
              <p className="text-xs text-muted-foreground mt-1">{todayOrders.length} venda(s)</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wide text-primary/80 font-medium">Ticket medio</p>
              <p className="text-2xl font-bold text-foreground mt-1">{fmt(todayTicket)}</p>
              <p className="text-xs text-muted-foreground mt-1">por venda hoje</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-primary/80 font-medium">Produtos da loja</p>
            <p className="text-3xl font-bold text-foreground mt-1">{products.length}</p>
          </div>

          {/* Insights da IA */}
          <div className="rounded-xl border border-primary/30 bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-heading text-sm text-primary flex items-center gap-2">
                <Bot className="h-4 w-4" /> Insights da IA
              </h3>
              <button
                onClick={fetchInsights}
                disabled={insightsLoading}
                className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
              >
                {insightsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Atualizar
              </button>
            </div>

            {!insightsLoaded && !insightsLoading && (
              <button
                onClick={fetchInsights}
                className="w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground transition-colors hover:bg-primary/10"
              >
                <Sparkles className="h-5 w-5 text-primary mx-auto mb-2" />
                Toque em "Atualizar" pra eu analisar seus numeros e te dar dicas. 🤖
              </button>
            )}

            {insightsLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Analisando seus numeros...</span>
              </div>
            )}

            {insightsLoaded && !insightsLoading && (
              <div className="space-y-2">
                {insights.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-3">Sem insights agora — esta tudo no jeito.</p>
                )}
                {insights.map((ins, i) => {
                  const s = INSIGHT_STYLE[ins.type];
                  return (
                    <div key={i} className={`rounded-lg border-l-4 ${s.bar} bg-secondary/40 p-3`}>
                      <div className="flex items-center gap-2">
                        {s.icon}
                        <p className="font-semibold text-sm text-foreground">{ins.title}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{ins.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Atalho Clara */}
          <button
            onClick={openClara}
            className="w-full flex items-center gap-3 rounded-full gradient-primary px-5 py-3 text-primary-foreground shadow-md transition-opacity hover:opacity-90"
          >
            <Briefcase className="h-5 w-5" />
            <span className="font-medium">Conversar com a Clara</span>
            <MessageCircle className="h-4 w-4 ml-auto" />
          </button>
        </div>
      )}

      {/* ============ ABA FINANCEIRO ============ */}
      {tab === 'financeiro' && (
        <div className="space-y-4 animate-fade-in">
          {/* Sub-sub-abas — chips compactos */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {([
              { id: 'completo', label: 'Resumo', icon: '📊' },
              { id: 'despesas', label: 'Despesas', icon: '💸' },
              { id: 'fiado', label: 'Fiado', icon: '📒' },
              { id: 'fornecedores', label: 'Fornec.', icon: '🏭' },
            ] as { id: FinSubTab; label: string; icon: string }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setFinTab(t.id)}
                className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  finTab === t.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="text-[11px]">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="font-heading text-sm text-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Lançamento rápido</h3>
            <div className="grid grid-cols-2 gap-2">
              <select value={quickEntry.category} onChange={e => setQuickEntry({ ...quickEntry, category: e.target.value as EntryOptionValue, isCreditCard: false })}
                className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                {entryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                <input type="number" step="0.01" value={quickEntry.amount} onChange={e => setQuickEntry({ ...quickEntry, amount: e.target.value })}
                  placeholder="0,00" className="w-full rounded-lg border border-border bg-secondary pl-9 pr-3 py-2 text-sm text-foreground" />
              </div>
            </div>
            <input value={quickEntry.description} onChange={e => setQuickEntry({ ...quickEntry, description: e.target.value })}
              placeholder="Descrição" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            {entryOptions.find(o => o.value === quickEntry.category)?.type === 'expense' && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setQuickEntry({ ...quickEntry, isCreditCard: !quickEntry.isCreditCard })}
                  className={`rounded-lg border p-2 text-xs font-medium ${quickEntry.isCreditCard ? 'border-orange-500 bg-orange-500/10 text-orange-400' : 'border-border bg-secondary text-muted-foreground'}`}>
                  💳 Cartão
                </button>
                <input type="date" value={quickEntry.dueDate} onChange={e => setQuickEntry({ ...quickEntry, dueDate: e.target.value })}
                  disabled={!quickEntry.isCreditCard} className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground disabled:opacity-50" />
              </div>
            )}
            <button onClick={submitQuickEntry} disabled={addEntry.isPending}
              className="w-full rounded-lg gradient-primary text-primary-foreground py-2.5 text-sm font-medium disabled:opacity-50">
              {addEntry.isPending ? 'Salvando...' : 'Salvar lançamento'}
            </button>
          </div>

          {/* Cards de topo: faturamento mes + lucro */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wide text-primary/80 font-medium">Faturamento mes</p>
              <p className="text-2xl font-bold text-foreground mt-1">{fmt(monthRevenue)}</p>
              <p className={`text-xs mt-1 ${monthDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ▲ {monthDelta.toFixed(1)}% vs mes anterior
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wide text-primary/80 font-medium">Lucro estimado</p>
              <p className={`text-2xl font-bold mt-1 ${monthProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(monthProfit)}</p>
              <p className="text-xs text-muted-foreground mt-1">margem {monthMargin.toFixed(1)}%</p>
            </div>
          </div>

          {/* === RESUMO COMPLETO === */}
          {finTab === 'completo' && (
            <>
              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h3 className="font-heading text-base text-primary">Resumo Completo</h3>

                {/* Entradas */}
                <div>
                  <p className="font-semibold text-foreground mb-1">Entradas (Vendas)</p>
                  {monthIncomeByMethod.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma venda registrada</p>
                  ) : (
                    monthIncomeByMethod.map(([k, v]) => (
                      <p key={k} className="text-sm text-muted-foreground">{k}: <span className="text-foreground">{fmt(v)}</span></p>
                    ))
                  )}
                  <p className="text-sm font-bold text-foreground mt-1">Total: {fmt(monthRevenue)}</p>
                </div>

                <div className="border-t border-border pt-3" />

                {/* Saidas */}
                <div>
                  <p className="font-semibold text-foreground mb-2">Saidas</p>
                  <p className="text-sm font-medium text-foreground mb-1">Por Categoria</p>
                  {monthExpenseByCat.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma despesa registrada</p>
                  ) : (
                    monthExpenseByCat.map(([k, v]) => (
                      <p key={k} className="text-sm text-muted-foreground">{k}: <span className="text-foreground">{fmt(v)}</span></p>
                    ))
                  )}
                  <p className="text-sm font-bold text-foreground mt-1">Total: {fmt(monthExpenses)}</p>
                </div>

                <div className="border-t border-border pt-3" />

                {/* Maior gasto fixo */}
                <div>
                  <p className="font-semibold text-foreground mb-1">Maior Gasto Fixo</p>
                  {biggestFixed ? (
                    <p className="text-sm text-muted-foreground">
                      {biggestFixed.description}: <span className="text-foreground">{fmt(Number(biggestFixed.amount))}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum gasto fixo registrado neste mes</p>
                  )}
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Maior Gasto Avulso</p>
                  {biggestVar ? (
                    <p className="text-sm text-muted-foreground">
                      {biggestVar.description}: <span className="text-foreground">{fmt(Number(biggestVar.amount))}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum gasto avulso registrado neste mes</p>
                  )}
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Produto Mais Vendido</p>
                  {topProduct ? (
                    <p className="text-sm text-muted-foreground">
                      {topProduct.name}: <span className="text-foreground">{fmt(topProduct.revenue)}</span> ({topProduct.qty} un)
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma venda registrada neste mes</p>
                  )}
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Fiado (Clientes me devem)</p>
                  <p className="text-base font-bold text-foreground">{fmt(fiadoOpen)}</p>
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Fornecedores (eu devo)</p>
                  <p className="text-base font-bold text-foreground">{fmt(supplierDebtTotal)}</p>
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Saldo em Caixa</p>
                  <p className="text-base font-bold text-foreground">{fmt(cashBalance)}</p>
                  <p className="text-xs text-muted-foreground">Entradas liquidas do mes (sem fiado) − despesas que ja sairam da conta</p>
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Saldo Disponivel</p>
                  <p className={`text-base font-bold ${availableBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(availableBalance)}</p>
                  <p className="text-xs text-muted-foreground">Caixa − cartão pendente</p>
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Saldo Futuro</p>
                  <p className={`text-base font-bold ${futureBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(futureBalance)}</p>
                  <p className="text-xs text-muted-foreground">Disponivel + Fiado a receber</p>
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Situacao Atual</p>
                  <p className={`text-sm font-bold ${cashBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {cashBalance >= 0 ? 'Positivo' : 'Negativo'}
                  </p>
                </div>

                <div className="border-t border-border pt-3" />

                <div>
                  <p className="font-semibold text-foreground mb-1">Situacao Futura</p>
                  <p className={`text-sm font-bold ${futureBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {futureBalance >= 0 ? 'Positivo' : 'Negativo'}
                  </p>
                </div>
              </div>

              {/* Faturamento 6 meses */}
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-heading text-sm text-primary mb-4 flex items-center gap-2">
                  📈 Faturamento — ultimos 6 meses
                </h3>
                <div className="flex items-end justify-between gap-2 h-32 mb-2">
                  {last6Months.map((m, i) => {
                    const h = m.revenue > 0 ? Math.max((m.revenue / max6) * 100, 8) : 0;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className={`text-[10px] font-medium ${m.revenue > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                          {m.revenue > 0 ? m.revenue.toFixed(2).replace('.', ',') : '—'}
                        </span>
                        <div className="w-full bg-secondary/40 rounded-t-md relative" style={{ height: '100%' }}>
                          {h > 0 && (
                            <div className="absolute bottom-0 w-full gradient-primary rounded-t-md" style={{ height: `${h}%` }} />
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Resumo mensal tabela */}
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-heading text-sm text-primary mb-3 flex items-center gap-2">
                  📋 Resumo mensal
                </h3>
                <div className="grid grid-cols-4 gap-2 text-[11px] text-muted-foreground border-b border-border pb-2">
                  <span>Mes</span>
                  <span className="text-right">Faturamento</span>
                  <span className="text-right">Despesas</span>
                  <span className="text-right">Lucro</span>
                </div>
                {[...last6Months].reverse().map((m, i) => (
                  <div key={i} className={`grid grid-cols-4 gap-2 text-xs py-2 border-b border-border/50 ${i === 0 ? 'font-bold text-foreground' : 'text-foreground/80'}`}>
                    <span>{m.key}</span>
                    <span className="text-right text-green-400">{fmt(m.revenue)}</span>
                    <span className="text-right text-red-400">{fmt(m.expenses)}</span>
                    <span className={`text-right ${m.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(m.profit)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* === DESPESAS === */}
          {finTab === 'despesas' && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-heading text-sm text-primary mb-3">💸 Despesas do mes</h3>
              <div className="mb-4 rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select value={quickEntry.category} onChange={e => setQuickEntry({ ...quickEntry, category: e.target.value as EntryOptionValue })}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
                    {entryOptions.filter(o => o.type === 'expense').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input type="number" step="0.01" value={quickEntry.amount} onChange={e => setQuickEntry({ ...quickEntry, amount: e.target.value })}
                    placeholder="Valor" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                </div>
                <input value={quickEntry.description} onChange={e => setQuickEntry({ ...quickEntry, description: e.target.value })}
                  placeholder="Descrição da despesa" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                <button onClick={submitQuickEntry} className="w-full rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium">Lançar despesa</button>
              </div>
              {expenseEntries.filter(e => new Date(e.date) >= startOfMonth).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhuma despesa registrada neste mes.</p>
              ) : (
                <div className="space-y-2">
                  {expenseEntries
                    .filter(e => new Date(e.date) >= startOfMonth)
                    .sort((a, b) => Number(b.amount) - Number(a.amount))
                    .map(e => (
                      <div key={e.id} className="flex items-center justify-between text-sm border-b border-border/50 pb-2">
                        <div className="min-w-0">
                          <p className="text-foreground truncate">{e.description}</p>
                          <p className="text-[10px] text-muted-foreground">{e.category} · {new Date(e.date).toLocaleDateString('pt-BR')}</p>
                        </div>
                        <p className="text-red-400 font-bold shrink-0">{fmt(Number(e.amount))}</p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* === FIADO === */}
          {finTab === 'fiado' && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-heading text-sm text-primary mb-3">📒 Fiado em aberto</h3>
              <div className="mb-4 rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={quickCredit.customer_name} onChange={e => setQuickCredit({ ...quickCredit, customer_name: e.target.value })} placeholder="Cliente"
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                  <input value={quickCredit.customer_phone} onChange={e => setQuickCredit({ ...quickCredit, customer_phone: e.target.value })} placeholder="Telefone"
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.01" value={quickCredit.amount} onChange={e => setQuickCredit({ ...quickCredit, amount: e.target.value })} placeholder="Valor"
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                  <input type="date" value={quickCredit.due_date} onChange={e => setQuickCredit({ ...quickCredit, due_date: e.target.value })}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                </div>
                <input value={quickCredit.description} onChange={e => setQuickCredit({ ...quickCredit, description: e.target.value })} placeholder="O que ficou fiado?"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                <button onClick={submitQuickCredit} disabled={addCredit.isPending}
                  className="w-full rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
                  Lançar fiado
                </button>
              </div>
              {credits.filter(c => c.status === 'open' || c.status === 'overdue').length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Ninguem te deve nada agora. ✅</p>
              ) : (
                <div className="space-y-2">
                  {credits
                    .filter(c => c.status === 'open' || c.status === 'overdue')
                    .map(c => {
                      const remaining = Number(c.amount) - Number(c.amount_paid);
                      const overdue = c.status === 'overdue';
                      return (
                        <div key={c.id} className={`rounded-lg border ${overdue ? 'border-red-500/40 bg-red-500/5' : 'border-border'} p-3`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">{c.customer_name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                vence {new Date(c.due_date).toLocaleDateString('pt-BR')} {overdue && '· ATRASADO'}
                              </p>
                            </div>
                            <p className={`font-bold shrink-0 ${overdue ? 'text-red-400' : 'text-foreground'}`}>{fmt(remaining)}</p>
                          </div>
                          {payingCreditId === c.id ? (
                            <div className="mt-2 flex gap-2">
                              <input type="number" step="0.01" value={payCreditAmount} onChange={e => setPayCreditAmount(e.target.value)} placeholder="Valor recebido"
                                className="min-w-0 flex-1 rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-foreground" />
                              <button onClick={() => receiveCredit(c)} className="rounded-md bg-green-500/20 px-3 text-xs font-medium text-green-400">Ok</button>
                            </div>
                          ) : (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button onClick={() => { setPayingCreditId(c.id); setPayCreditAmount(String(remaining.toFixed(2))); }} className="rounded-md bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400">Receber</button>
                              <button onClick={async () => { setRemindingCreditId(c.id); try { await sendReminder.mutateAsync({ accountId: c.id }); toast.success('Cobrança enviada'); } catch (e: any) { toast.error(e?.message || 'Erro ao cobrar'); } finally { setRemindingCreditId(null); } }} disabled={remindingCreditId === c.id} className="rounded-md bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-50">
                                {remindingCreditId === c.id ? 'Enviando...' : 'Cobrar'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  <div className="border-t border-border pt-2 flex justify-between text-sm">
                    <span className="font-medium text-foreground">Total a receber:</span>
                    <span className="font-bold text-foreground">{fmt(fiadoOpen)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === FORNECEDORES === */}
          {finTab === 'fornecedores' && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-heading text-sm text-primary mb-3">🏭 Fornecedores</h3>
              <div className="mb-4 rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setQuickDebt({ ...quickDebt, type: 'payable' })}
                    className={`rounded-lg border p-2 text-xs font-medium ${quickDebt.type === 'payable' ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-border bg-card text-muted-foreground'}`}>
                    Eu devo
                  </button>
                  <button onClick={() => setQuickDebt({ ...quickDebt, type: 'receivable' })}
                    className={`rounded-lg border p-2 text-xs font-medium ${quickDebt.type === 'receivable' ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-border bg-card text-muted-foreground'}`}>
                    Vão me pagar
                  </button>
                </div>
                <input value={quickDebt.name} onChange={e => setQuickDebt({ ...quickDebt, name: e.target.value })} placeholder="Fornecedor ou cobrança"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.01" value={quickDebt.amount} onChange={e => setQuickDebt({ ...quickDebt, amount: e.target.value })} placeholder="Valor"
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                  <input type="date" value={quickDebt.dueDate} onChange={e => setQuickDebt({ ...quickDebt, dueDate: e.target.value })}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground" />
                </div>
                <button onClick={submitQuickDebt} disabled={addDebt.isPending}
                  className="w-full rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">
                  Lançar conta/cobrança
                </button>
              </div>
              {debts.filter((d: any) => !d.paid).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sem contas em aberto com fornecedores.</p>
              ) : (
                <div className="space-y-2">
                  {debts.filter((d: any) => !d.paid).map((d: any) => {
                    const receivable = d.type === 'owed' || d.type === 'receivable';
                    return (
                    <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/50 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{String(d.name || '').replace(/^🏭[^:]+::/, '')}</p>
                        <p className="text-[10px] text-muted-foreground">{receivable ? 'a receber' : 'a pagar'} · {d.due_date ? `vence ${new Date(d.due_date).toLocaleDateString('pt-BR')}` : 'sem vencimento'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-bold ${receivable ? 'text-green-400' : 'text-red-400'}`}>{fmt(Number(d.amount || 0))}</span>
                        <button onClick={() => updateDebt.mutate({ ...d, paid: true })} className="rounded-md p-1 text-green-400 hover:bg-green-400/10"><Check className="h-4 w-4" /></button>
                      </div>
                    </div>
                  );})}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Clara — chat flutuante (só renderiza se for controlado internamente) */}
      {!onOpenClara && (
        <ClaraChat
          tenantId={tenantId}
          tenantName={tenantName}
          open={claraOpen}
          onClose={() => setClaraOpen(false)}
        />
      )}
    </div>
  );
};

export default TenantBusinessPanel;
