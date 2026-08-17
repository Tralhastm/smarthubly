import { useState, useEffect, useMemo } from 'react';
import {
  useFinancialEntries,
  useAddFinancialEntry,
  useUpdateFinancialEntry,
  useDeleteFinancialEntry,
  useDebts,
  useAddDebt,
  useUpdateDebt,
  useDeleteDebt,
} from '@/hooks/useFinancial';
import { useOrders } from '@/hooks/useOrders';
import FiadoTab from './FiadoTab';
import FinancialReportPDFButton from './FinancialReportPDFButton';
import TenantBusinessPanel from './TenantBusinessPanel';
import { useProducts } from '@/hooks/useProducts';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useIntegrationSettings } from '@/hooks/useIntegration';
import { supabase } from '@/integrations/supabase/client';
import { isEmbedMode } from '@/lib/embed-mode';
import { useSubTabs } from '@/lib/admin-subtabs';
import {
  Plus, Trash2, TrendingUp, Check, Factory,
  Save, Loader2, Settings, AlertTriangle, CheckCircle2, AlertCircle,
  Sparkles, Lightbulb, Calendar, Target, Wallet, Receipt, Zap,
  ArrowDownCircle, ArrowUpCircle, PiggyBank, ShoppingCart, Truck,
  Wifi, Home, Wrench, Users as UsersIcon, Package, MoreHorizontal,
  Eye, CreditCard, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// (CLARA_BASE_URL removido — Clara agora é o painel nativo TenantBusinessPanel, sem iframe externo)

type EntryCategory = 'sales' | 'rent' | 'utilities' | 'salaries' | 'inventory' | 'marketing' | 'taxes' | 'maintenance' | 'other_in' | 'other_out';

// IMPORTANT: `group` precisa bater com o CHECK constraint da tabela financial_entries:
// permitidos = fixed | variable | investment | unexpected | taxa_plataforma | venda | dropshipping | taxa_entrega
const CATEGORY_META: Record<EntryCategory, { label: string; icon: any; type: 'income' | 'expense'; group: string }> = {
  sales:       { label: 'Venda avulsa',     icon: ShoppingCart, type: 'income',  group: 'venda' },
  other_in:    { label: 'Outra entrada',    icon: ArrowUpCircle, type: 'income',  group: 'variable' },
  rent:        { label: 'Aluguel',          icon: Home,         type: 'expense', group: 'fixed' },
  utilities:   { label: 'Luz / Água / Net', icon: Wifi,         type: 'expense', group: 'fixed' },
  salaries:    { label: 'Salário / Pró-labore', icon: UsersIcon, type: 'expense', group: 'fixed' },
  inventory:   { label: 'Compra de estoque', icon: Package,     type: 'expense', group: 'variable' },
  marketing:   { label: 'Marketing / Anúncio', icon: Sparkles,  type: 'expense', group: 'variable' },
  
  taxes:       { label: 'Imposto / Taxa',   icon: Receipt,      type: 'expense', group: 'fixed' },
  maintenance: { label: 'Manutenção / Conserto', icon: Wrench,  type: 'expense', group: 'unexpected' },
  other_out:   { label: 'Outra saída',      icon: MoreHorizontal, type: 'expense', group: 'variable' },
};

// Resolve a chave fina da categoria (inventory, rent, marketing...).
// `subcategory` é a coluna nova; quando NULL (legado), tenta usar `category`
// se já bater com uma chave fina (caso de dados muito antigos onde category
// tinha o nome da subcategoria diretamente).
const entrySubcategory = (e: { category?: string | null; subcategory?: string | null }): string | null => {
  if (e.subcategory) return e.subcategory;
  if (e.category && (e.category as string) in CATEGORY_META) return e.category as string;
  return null;
};

const TenantFinancialManager = ({ tenantId, isDropshipping }: { tenantId: string; isDropshipping?: boolean }) => {
  const embedded = isEmbedMode();
  const [tab, setTab] = useState<'overview' | 'cashflow' | 'entries' | 'card' | 'debts' | 'fiado' | 'recurring' | 'suppliers' | 'projection' | 'fee_config' | 'clara'>('overview');
  const { data: entries = [], isLoading: le } = useFinancialEntries(tenantId);
  const { data: debts = [], isLoading: ld } = useDebts(tenantId);
  const { data: orders = [] } = useOrders(tenantId);
  const { data: products = [] } = useProducts(tenantId);
  const { data: suppliers = [] } = useSuppliers(tenantId);
  const { data: integration } = useIntegrationSettings(tenantId);
  const addEntry = useAddFinancialEntry();
  const delEntry = useDeleteFinancialEntry(tenantId);
  const updEntry = useUpdateFinancialEntry(tenantId);
  const addDebt = useAddDebt();
  const updateDebt = useUpdateDebt();
  const delDebt = useDeleteDebt(tenantId);
  // (claraFullscreen removido — painel nativo não usa iframe)

  const [showAddEntry, setShowAddEntry] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [showAddDebt, setShowAddDebt] = useState(false);
  // Sub-toggle dentro da aba 'debts': 'contas' (a pagar/receber genérico) ou 'fiado' (clientes)
  const [debtsView, setDebtsView] = useState<'contas' | 'fiado'>('contas');
  const [ef, setEf] = useState<{ category: EntryCategory; amount: string; description: string; isCreditCard: boolean; dueDate: string; expenseKind: 'fixed' | 'variable' | 'auto' }>({
    category: 'sales', amount: '', description: '', isCreditCard: false, dueDate: '', expenseKind: 'auto',
  });
  // Pagamento de fatura (total ou parcial)
  const [payDialog, setPayDialog] = useState<{ entry: any | null; mode: 'full' | 'partial'; amount: string }>({ entry: null, mode: 'full', amount: '' });
  const [df, setDf] = useState({ name: '', amount: '', dueDate: '', type: 'payable' as 'payable' | 'receivable' });
  // Form de dívida com fornecedor (na aba Fornecedores)
  const [showAddSupplierDebt, setShowAddSupplierDebt] = useState(false);
  const [sdf, setSdf] = useState({ supplierId: '', description: '', amount: '', dueDate: '' });
  const [revenueGoal, setRevenueGoal] = useState<number>(0);
  const [savingGoal, setSavingGoal] = useState(false);

  const [feeMode, setFeeMode] = useState('margin');
  const [feeSplitPercent, setFeeSplitPercent] = useState(50);
  const [savingFee, setSavingFee] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('tenants').select('fee_mode, fee_split_store_percent').eq('id', tenantId).single();
      if (data) {
        setFeeMode((data as any).fee_mode || 'margin');
        setFeeSplitPercent((data as any).fee_split_store_percent ?? 50);
      }
      const goal = localStorage.getItem(`revenue_goal_${tenantId}`);
      if (goal) setRevenueGoal(Number(goal));
    })();
  }, [tenantId]);

  // ============ AUTOMATED CALCULATIONS ============
  // Receita REAL = somente pedidos entregues, excluindo fiado
  // (fiado vai pra credit_accounts e só vira receita quando o cliente paga,
  // momento em que é lançado manualmente como entrada — evita contagem dupla).
  // Pedidos não entregues (received/preparing/out-for-delivery) entram em
  // "pendingRevenue" (a receber) e NÃO em receita realizada.
  const validOrders = orders.filter(o => o.status !== 'cancelled');
  const isFiado = (o: { payment_method?: string | null }) =>
    (o.payment_method || '').toLowerCase() === 'fiado';
  const realizedOrders = validOrders.filter(o => o.status === 'delivered' && !isFiado(o));
  const orderRevenue = realizedOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const orderFees = realizedOrders.reduce((s, o) => s + Number(o.platform_fee || 0), 0);

  const todayStr = new Date().toDateString();
  const todayOrders = realizedOrders.filter(o => new Date(o.created_at).toDateString() === todayStr);
  const todayRev = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const monthOrders = realizedOrders.filter(o => {
    const d = new Date(o.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  const monthRev = monthOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const monthFees = monthOrders.reduce((s, o) => s + Number(o.platform_fee || 0), 0);

  // Manual entries this month.
  // IMPORTANT: entries com marcador "#ORDER_REVENUE:" sao criadas automaticamente
  // pelo trigger recordOrderRevenue quando um pedido vira "delivered". Como ja
  // contamos esses pedidos via `monthRev` (orders entregues), precisamos EXCLUIR
  // essas entries pra evitar dupla contagem (bug R$50,42 -> R$100,84).
  const isOrderRevenueEntry = (e: { description?: string | null }) =>
    !!(e.description && e.description.includes('#ORDER_REVENUE:'));
  const monthEntries = entries.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  const monthIn = monthEntries
    .filter(e => e.type === 'income' && !isOrderRevenueEntry(e))
    .reduce((s, e) => s + Number(e.amount), 0);
  // Helper: uma despesa "saiu da conta" SOMENTE se NÃO for cartão pendente.
  // Cartão pendente (is_credit_card=true E paid=false) NÃO afeta o saldo em conta — só o disponível.
  const isPendingCardExpense = (e: any) => e.type === 'expense' && e.is_credit_card === true && e.paid === false;
  const monthOut = monthEntries
    .filter(e => e.type === 'expense' && !isPendingCardExpense(e))
    .reduce((s, e) => s + Number(e.amount), 0);

  // TRUE month profit: real orders + manual incomes - fees - manual expenses
  const monthRealIncome = monthRev + monthIn;
  const monthRealOutflow = monthFees + monthOut;
  const monthProfit = monthRealIncome - monthRealOutflow;
  const monthMargin = monthRealIncome > 0 ? (monthProfit / monthRealIncome) * 100 : 0;

  // Lifetime — exclui order-revenue entries (não contar pedidos 2x) e cartão pendente (ainda não saiu)
  const totalIn = entries.filter(e => e.type === 'income' && !isOrderRevenueEntry(e)).reduce((s, e) => s + Number(e.amount), 0);
  const totalOut = entries
    .filter(e => e.type === 'expense' && !isPendingCardExpense(e))
    .reduce((s, e) => s + Number(e.amount), 0);
  // SALDO NA CONTA: dinheiro físico hoje. Cartão pendente NÃO entra.
  const accountBalance = (totalIn + orderRevenue) - (totalOut + orderFees);
  const balance = accountBalance; // alias para compat com cashflow/projeções abaixo

  // Months active
  const allDates = [...entries.map(e => e.date), ...validOrders.map(o => o.created_at)];
  const monthsActiveSet = new Set(allDates.map(d => d.slice(0, 7)));
  const monthsActive = Math.max(monthsActiveSet.size, 1);
  const avgMonthlyRevenue = (orderRevenue + totalIn) / monthsActive;
  const avgMonthlyExpense = (orderFees + totalOut) / monthsActive;
  const avgMonthlyProfit = avgMonthlyRevenue - avgMonthlyExpense;

  // Pending receivables (orders not yet delivered/cancelled)
  const pendingOrders = orders.filter(o => !['delivered', 'cancelled'].includes(o.status));
  const pendingRevenue = pendingOrders.reduce((s, o) => s + Number(o.total || 0), 0);

  // Debts summary — DB usa 'owe' (eu devo) e 'owed' (vão me pagar); aceita também legado 'payable'/'receivable'
  const isPayableType = (t: string) => t === 'owe' || t === 'payable';
  const isReceivableType = (t: string) => t === 'owed' || t === 'receivable';
  const debtsToPay = debts.filter(d => !d.paid && isPayableType(d.type)).reduce((s, d) => s + Number(d.amount), 0);
  const debtsToReceive = debts.filter(d => !d.paid && isReceivableType(d.type)).reduce((s, d) => s + Number(d.amount), 0);

  // ===== CARTÃO DE CRÉDITO =====
  // Despesas marcadas como cartão e ainda não pagas = saldo futuro (vai sair quando pagar a fatura)
  const creditCardEntries = entries.filter((e: any) => isPendingCardExpense(e));
  const creditCardPending = creditCardEntries.reduce((s, e) => s + Number(e.amount), 0);
  // SALDO DISPONÍVEL: o que sobra de fato pra gastar (conta - dívida do cartão)
  const availableBalance = accountBalance - creditCardPending;

  // Cash flow last 6 months — usa apenas pedidos REALIZADOS (delivered, sem fiado)
  const cashflow = useMemo(() => {
    const months: { key: string; label: string; income: number; expense: number; profit: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(thisYear, thisMonth - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short' });
      const mOrders = realizedOrders.filter(o => o.created_at.startsWith(key));
      const mEntries = entries.filter(e => e.date.startsWith(key));
      const inc = mOrders.reduce((s, o) => s + Number(o.total || 0), 0)
        + mEntries.filter(e => e.type === 'income' && !isOrderRevenueEntry(e)).reduce((s, e) => s + Number(e.amount), 0);
      const exp = mOrders.reduce((s, o) => s + Number(o.platform_fee || 0), 0) + mEntries.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0);
      months.push({ key, label, income: inc, expense: exp, profit: inc - exp });
    }
    return months;
  }, [realizedOrders, entries, thisMonth, thisYear]);

  // ============ HEALTH SCORE (semáforo) ============
  const healthScore = (() => {
    let score = 50;
    if (monthProfit > 0) score += 20;
    if (monthMargin > 20) score += 15;
    if (monthMargin > 40) score += 10;
    if (monthProfit < 0) score -= 30;
    if (debtsToPay > monthRealIncome) score -= 20;
    if (todayOrders.length > 0) score += 5;
    if (revenueGoal > 0 && monthRealIncome >= revenueGoal) score += 10;
    if (monthOrders.length === 0 && monthsActive > 1) score -= 15;
    return Math.max(0, Math.min(100, score));
  })();

  const healthStatus = healthScore >= 70 ? 'good' : healthScore >= 40 ? 'warning' : 'danger';

  // ============ AUTO INSIGHTS ============
  const insights = useMemo(() => {
    const list: { type: 'success' | 'warning' | 'danger' | 'tip'; title: string; text: string }[] = [];
    if (monthOrders.length === 0 && monthsActive > 1) {
      list.push({ type: 'danger', title: 'Sem vendas este mês', text: 'Você não recebeu nenhum pedido em ' + now.toLocaleDateString('pt-BR', { month: 'long' }) + '. Hora de fazer uma promoção!' });
    }
    if (monthProfit < 0) {
      list.push({ type: 'danger', title: 'Mês no vermelho', text: `Você gastou R$${Math.abs(monthProfit).toFixed(2)} a mais do que ganhou. Reduza despesas variáveis ou aumente vendas.` });
    } else if (monthProfit > 0 && monthMargin > 30) {
      list.push({ type: 'success', title: 'Excelente margem!', text: `Você está lucrando ${monthMargin.toFixed(0)}% do faturamento. Continue assim!` });
    }
    if (debtsToPay > 0 && debtsToPay > monthRealIncome * 0.5) {
      list.push({ type: 'warning', title: 'Dívidas pesadas', text: `Você deve R$${debtsToPay.toFixed(2)}, mais da metade da sua receita do mês. Priorize pagamentos.` });
    }
    if (debtsToReceive > 0) {
      list.push({ type: 'tip', title: 'Dinheiro a receber', text: `Tem R$${debtsToReceive.toFixed(2)} para entrar. Cobre seus clientes!` });
    }
    if (revenueGoal > 0) {
      const pct = monthRealIncome / revenueGoal * 100;
      if (pct >= 100) list.push({ type: 'success', title: 'Meta batida! 🎉', text: `Você atingiu ${pct.toFixed(0)}% da meta deste mês.` });
      else if (pct >= 70) list.push({ type: 'tip', title: 'Quase lá!', text: `Você está em ${pct.toFixed(0)}% da meta. Faltam R$${(revenueGoal - monthRealIncome).toFixed(2)}.` });
      else if (pct < 30 && now.getDate() > 15) list.push({ type: 'warning', title: 'Meta distante', text: `Faltam R$${(revenueGoal - monthRealIncome).toFixed(2)} pra bater a meta. Acelere!` });
    }
    const fixedExp = monthEntries.filter(e => e.type === 'expense' && (CATEGORY_META[entrySubcategory(e) as EntryCategory]?.group ?? e.category) === 'fixed').reduce((s, e) => s + Number(e.amount), 0);
    if (fixedExp > 0 && fixedExp > monthRealIncome * 0.6 && monthRealIncome > 0) {
      list.push({ type: 'warning', title: 'Custos fixos altos', text: `${((fixedExp / monthRealIncome) * 100).toFixed(0)}% da sua receita vai para custos fixos (aluguel, luz, etc). Tente reduzir.` });
    }
    if (pendingRevenue > 0) {
      list.push({ type: 'tip', title: 'Pedidos em andamento', text: `R$${pendingRevenue.toFixed(2)} ainda vão entrar quando os ${pendingOrders.length} pedido(s) forem entregues.` });
    }
    if (list.length === 0) {
      list.push({ type: 'tip', title: 'Tudo tranquilo', text: 'Seu negócio está estável. Que tal definir uma meta de faturamento?' });
    }
    return list.slice(0, 5);
  }, [monthProfit, monthMargin, monthOrders.length, monthsActive, debtsToPay, debtsToReceive, monthRealIncome, revenueGoal, monthRev, monthEntries, pendingRevenue, pendingOrders.length]);

  // ============ SUPPLIER SUMMARY (dropshipping) ============
  // Helpers para dívidas manuais com fornecedor (convenção: name = "🏭<supplier_id>::descrição")
  const SUPPLIER_DEBT_PREFIX = '🏭';
  const parseSupplierDebt = (name: string) => {
    if (!name?.startsWith(SUPPLIER_DEBT_PREFIX)) return null;
    const rest = name.slice(SUPPLIER_DEBT_PREFIX.length);
    const sep = rest.indexOf('::');
    if (sep < 0) return null;
    return { supplierId: rest.slice(0, sep), description: rest.slice(sep + 2) };
  };
  const supplierManualDebts = debts.filter(d => isPayableType(d.type) && parseSupplierDebt(d.name));

  const supplierSummary = (() => {
    const summary: Record<string, { name: string; totalCost: number; totalSale: number; orderCount: number; manualDebt: number; manualPaid: number }> = {};
    // 1) Pedidos entregues (dropshipping)
    if (isDropshipping) {
      const deliveredOrders = orders.filter(o => o.status === 'delivered');
      deliveredOrders.forEach(order => {
        order.order_items?.forEach((item: any) => {
          const product = products.find(p => p.name === item.product_name);
          if (product?.supplier_id) {
            const sup = suppliers.find(s => s.id === product.supplier_id);
            if (!summary[product.supplier_id]) {
              summary[product.supplier_id] = { name: sup?.name || 'Desconhecido', totalCost: 0, totalSale: 0, orderCount: 0, manualDebt: 0, manualPaid: 0 };
            }
            summary[product.supplier_id].totalCost += ((product as any).original_price || 0) * item.quantity;
            summary[product.supplier_id].totalSale += item.product_price * item.quantity;
            summary[product.supplier_id].orderCount += item.quantity;
          }
        });
      });
    }
    // 2) Dívidas manuais lançadas pelo usuário
    supplierManualDebts.forEach(d => {
      const parsed = parseSupplierDebt(d.name);
      if (!parsed) return;
      const sup = suppliers.find(s => s.id === parsed.supplierId);
      if (!summary[parsed.supplierId]) {
        summary[parsed.supplierId] = { name: sup?.name || 'Fornecedor', totalCost: 0, totalSale: 0, orderCount: 0, manualDebt: 0, manualPaid: 0 };
      }
      if (d.paid) summary[parsed.supplierId].manualPaid += Number(d.amount);
      else summary[parsed.supplierId].manualDebt += Number(d.amount);
    });
    return Object.values(summary);
  })();

  const totalSupplierCost = supplierSummary.reduce((s, x) => s + x.totalCost + x.manualDebt, 0);
  const totalSupplierSale = supplierSummary.reduce((s, x) => s + x.totalSale, 0);
  const dropshippingProfit = totalSupplierSale - totalSupplierCost;

  const loadingFinance = le || ld;

  const saveFeeConfig = async () => {
    setSavingFee(true);
    const { error } = await supabase.from('tenants').update({ fee_mode: feeMode, fee_split_store_percent: feeSplitPercent } as any).eq('id', tenantId);
    setSavingFee(false);
    if (error) { toast.error('Erro ao salvar'); return; }
    toast.success('Configuração de taxa salva!');
  };

  const saveGoal = async () => {
    setSavingGoal(true);
    localStorage.setItem(`revenue_goal_${tenantId}`, String(revenueGoal));
    setTimeout(() => { setSavingGoal(false); toast.success('Meta salva!'); }, 300);
  };

  const submitEntry = () => {
    if (!ef.amount || Number(ef.amount) <= 0) { toast.error('Informe o valor'); return; }
    const meta = CATEGORY_META[ef.category];
    // Cartão de crédito só faz sentido em despesas; entradas sempre entram como pagas
    const onCard = meta.type === 'expense' && ef.isCreditCard;
    // Para despesas, permite o usuário sobrescrever o group (Fixa vs Avulsa/Variável).
    // Para entradas, mantém o group da subcategoria.
    const groupOverride =
      meta.type === 'expense' && ef.expenseKind !== 'auto' ? ef.expenseKind : meta.group;

    const payload: any = {
      tenant_id: tenantId,
      type: meta.type,
      amount: parseFloat(ef.amount),
      description: ef.description || meta.label,
      category: groupOverride,
      subcategory: ef.category,
      is_credit_card: onCard,
      paid: !onCard,
      paid_at: onCard ? null : new Date().toISOString(),
      due_date: onCard && ef.dueDate ? new Date(ef.dueDate + 'T12:00:00').toISOString() : null,
    };

    const resetForm = () => {
      setEf({ category: 'sales', amount: '', description: '', isCreditCard: false, dueDate: '', expenseKind: 'auto' });
      setShowAddEntry(false);
      setEditingEntryId(null);
    };

    if (editingEntryId) {
      updEntry.mutate({ id: editingEntryId, ...payload }, {
        onSuccess: () => { toast.success('✏️ Lançamento atualizado'); resetForm(); },
        onError: () => toast.error('Erro ao atualizar'),
      });
    } else {
      addEntry.mutate({ ...payload, date: new Date().toISOString() }, {
        onSuccess: () => {
          toast.success(
            onCard ? '💳 Despesa no cartão registrada (saldo futuro)' :
            meta.type === 'income' ? '✅ Entrada registrada' : '💸 Saída registrada'
          );
          resetForm();
        },
        onError: () => toast.error('Erro ao salvar'),
      });
    }
  };

  const startEditEntry = (e: any) => {
    const subKey = entrySubcategory(e) as EntryCategory | null;
    const cat: EntryCategory = subKey && subKey in CATEGORY_META
      ? subKey
      : (e.type === 'income' ? 'other_in' : 'other_out');
    const groupVal = e.category as string;
    const expenseKind: 'fixed' | 'variable' | 'auto' =
      e.type === 'expense' && (groupVal === 'fixed' || groupVal === 'variable')
        ? (groupVal as 'fixed' | 'variable')
        : 'auto';
    setEf({
      category: cat,
      amount: String(e.amount ?? ''),
      description: e.description || '',
      isCreditCard: !!e.is_credit_card,
      dueDate: e.due_date ? new Date(e.due_date).toISOString().slice(0, 10) : '',
      expenseKind,
    });
    setEditingEntryId(e.id);
    setShowAddEntry(true);
    // scroll to top of entries tab
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  const submitDebt = () => {
    if (!df.name || !df.amount || Number(df.amount) <= 0) { toast.error('Preencha nome e valor'); return; }
    // DB CHECK constraint exige 'owe' (eu devo) ou 'owed' (vão me pagar)
    const dbType = df.type === 'payable' ? 'owe' : 'owed';
    addDebt.mutate({
      tenant_id: tenantId, name: df.name, amount: parseFloat(df.amount),
      due_date: df.dueDate || null, paid: false, type: dbType,
    } as any, {
      onSuccess: () => {
        toast.success(df.type === 'payable' ? '📋 Conta a pagar adicionada' : '💰 Valor a receber adicionado');
        setDf({ name: '', amount: '', dueDate: '', type: 'payable' });
        setShowAddDebt(false);
      },
      onError: (e: any) => toast.error('Erro ao salvar: ' + (e?.message || 'tente novamente')),
    });
  };

  // Abas reorganizadas: Saúde + Clara como visões iniciais; Fluxo absorve Projeção;
  // Contas+Fiado viram uma aba só ('debts') com toggle interno (Pagar | Receber/Fiado).
  const tabs = useSubTabs('financial', [
    { id: 'overview', label: '🏥 Saúde', icon: Sparkles },
    ...(embedded ? [] : [{ id: 'clara', label: '🤖 Clara', icon: Sparkles }]),
    { id: 'cashflow', label: '📊 Fluxo', icon: TrendingUp },
    { id: 'entries', label: '💸 Lançar', icon: Receipt },
    { id: 'card', label: '💳 Cartão', icon: CreditCard },
    { id: 'debts', label: '💰 A Pagar / Receber', icon: Wallet },
    { id: 'suppliers', label: '🏭 Fornec.', icon: Factory },
    { id: 'fee_config', label: '⚙️ Taxa', icon: Settings },
  ]);

  // Se a sub-aba atual foi escondida pelo super admin, cai na primeira visível.
  useEffect(() => {
    if (tabs.length && !tabs.some(t => t.id === tab)) setTab(tabs[0].id as any);
  }, [tabs, tab]);

  // IMPORTANTE: o early-return de loading precisa vir DEPOIS de todos os hooks,
  // senão a ordem dos hooks muda entre renders (React error #310).
  if (loadingFinance) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;


  const healthColors = {
    good:    { bg: 'from-green-500/20 to-emerald-500/10',  ring: 'border-green-500/40', text: 'text-green-400', label: '😊 Saudável',  msg: 'Seu negócio vai bem! Continue de olho.' },
    warning: { bg: 'from-yellow-500/20 to-orange-500/10', ring: 'border-yellow-500/40', text: 'text-yellow-400', label: '😐 Atenção',  msg: 'Alguns pontos precisam ser ajustados.' },
    danger:  { bg: 'from-red-500/20 to-rose-500/10',      ring: 'border-red-500/40',   text: 'text-red-400',    label: '😰 Cuidado!', msg: 'Seu negócio está em risco. Aja agora.' },
  }[healthStatus];

  const insightStyles = {
    success: { bg: 'bg-green-500/10 border-green-500/30',  icon: <CheckCircle2 className="h-4 w-4 text-green-400" /> },
    warning: { bg: 'bg-yellow-500/10 border-yellow-500/30', icon: <AlertTriangle className="h-4 w-4 text-yellow-400" /> },
    danger:  { bg: 'bg-red-500/10 border-red-500/30',       icon: <AlertCircle className="h-4 w-4 text-red-400" /> },
    tip:     { bg: 'bg-primary/10 border-primary/30',       icon: <Lightbulb className="h-4 w-4 text-primary" /> },
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`rounded-xl px-2 py-2 text-[11px] sm:text-xs font-medium leading-tight transition-all text-center ${tab === t.id ? 'gradient-primary text-primary-foreground shadow-md' : 'bg-secondary text-muted-foreground hover:bg-secondary/70'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <FinancialReportPDFButton tenantId={tenantId} />
        </div>
      </div>

      {/* ====== SAÚDE DO NEGÓCIO ====== */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Health card */}
          <div className={`rounded-2xl border-2 ${healthColors.ring} bg-gradient-to-br ${healthColors.bg} p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Saúde do seu negócio</p>
                <p className={`text-2xl font-bold ${healthColors.text} mt-1`}>{healthColors.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{healthColors.msg}</p>
              </div>
              <div className="text-right">
                <div className={`text-4xl font-extrabold ${healthColors.text}`}>{healthScore}</div>
                <p className="text-[10px] text-muted-foreground">de 100</p>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full transition-all ${healthStatus === 'good' ? 'bg-green-500' : healthStatus === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${healthScore}%` }} />
            </div>
          </div>

          {/* Quanto entrou / saiu / sobrou - linguagem leiga */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" /> Este mês ({now.toLocaleDateString('pt-BR', { month: 'long' })})
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-green-500/10 p-3">
                <div className="flex items-center gap-2">
                  <ArrowUpCircle className="h-5 w-5 text-green-400" />
                  <div>
                    <p className="text-xs text-muted-foreground">Quanto entrou</p>
                    <p className="text-[10px] text-muted-foreground">Vendas + entradas manuais</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-green-400">R${monthRealIncome.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-red-500/10 p-3">
                <div className="flex items-center gap-2">
                  <ArrowDownCircle className="h-5 w-5 text-red-400" />
                  <div>
                    <p className="text-xs text-muted-foreground">Quanto saiu da conta</p>
                    <p className="text-[10px] text-muted-foreground">Despesas pagas + taxa plataforma</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-red-400">R${monthRealOutflow.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-orange-500/10 p-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-orange-400" />
                  <div>
                    <p className="text-xs text-muted-foreground">Cartão pendente</p>
                    <p className="text-[10px] text-muted-foreground">Ainda não saiu do banco</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-orange-400">−R${creditCardPending.toFixed(2)}</p>
              </div>
              <div className={`flex items-center justify-between rounded-lg p-3 ${availableBalance >= 0 ? 'bg-primary/10' : 'bg-red-500/15'}`}>
                <div className="flex items-center gap-2">
                  <PiggyBank className={`h-5 w-5 ${availableBalance >= 0 ? 'text-primary' : 'text-red-400'}`} />
                  <div>
                    <p className="text-xs text-foreground font-medium">Saldo disponível</p>
                    <p className="text-[10px] text-muted-foreground">Conta − cartão pendente</p>
                  </div>
                </div>
                <p className={`text-xl font-extrabold ${availableBalance >= 0 ? 'text-primary' : 'text-red-400'}`}>R${availableBalance.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Meta de faturamento mensal
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={revenueGoal || ''}
                  onChange={e => {
                    const onlyDigits = e.target.value.replace(/\D/g, '');
                    setRevenueGoal(onlyDigits ? Number(onlyDigits) : 0);
                  }}
                  placeholder="0"
                  className="w-full rounded-lg border border-border bg-secondary pl-9 pr-3 py-2 text-sm text-foreground" />
              </div>
              <button onClick={saveGoal} disabled={savingGoal}
                className="rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50">
                {savingGoal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </button>
            </div>
            {revenueGoal > 0 && (
              <>
                <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (monthRealIncome / revenueGoal) * 100)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  R${monthRealIncome.toFixed(2)} de R${revenueGoal.toFixed(2)} ({((monthRealIncome / revenueGoal) * 100).toFixed(0)}%)
                </p>
              </>
            )}
          </div>

          {/* Insights automáticos */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> O que você precisa saber agora
            </p>
            {insights.map((ins, i) => {
              const st = insightStyles[ins.type];
              return (
                <div key={i} className={`rounded-lg border p-3 ${st.bg}`}>
                  <div className="flex items-start gap-2">
                    {st.icon}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{ins.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{ins.text}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Saldos: Conta / Cartão (futuro) / Disponível */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border bg-gradient-to-br from-secondary to-card p-3">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Wallet className="h-3 w-3" /> Na conta
                </p>
                <p className={`text-base font-bold ${accountBalance >= 0 ? 'text-foreground' : 'text-red-400'}`}>R${accountBalance.toFixed(2)}</p>
                <p className="text-[9px] text-muted-foreground">o que aparece no banco</p>
              </div>
              <div className="rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-card p-3">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <CreditCard className="h-3 w-3" /> Cartão
                </p>
                <p className="text-base font-bold text-orange-400">−R${creditCardPending.toFixed(2)}</p>
                <p className="text-[9px] text-muted-foreground">vai sair na fatura</p>
              </div>
              <div className={`rounded-xl border p-3 bg-gradient-to-br ${availableBalance >= 0 ? 'border-primary/40 from-primary/15 to-card' : 'border-red-500/40 from-red-500/15 to-card'}`}>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <PiggyBank className="h-3 w-3" /> Disponível
                </p>
                <p className={`text-base font-bold ${availableBalance >= 0 ? 'text-primary' : 'text-red-400'}`}>R${availableBalance.toFixed(2)}</p>
                <p className="text-[9px] text-muted-foreground">pode gastar mesmo</p>
              </div>
            </div>
            {/* Projeção depois de receber/pagar tudo */}
            {(() => {
              const totalToReceive = pendingRevenue + debtsToReceive;
              const futureBalance = availableBalance + totalToReceive - debtsToPay;
              return (
                <div className={`rounded-lg border p-2.5 text-xs flex items-center justify-between ${futureBalance >= 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  <span className="text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Após receber e pagar tudo:</span>
                  <span className={`font-bold ${futureBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>R${futureBalance.toFixed(2)}</span>
                </div>
              );
            })()}
          </div>

          {/* Maiores saídas — Fixas vs Avulsas (mês atual) */}
          {(() => {
            const monthExpenses = monthEntries.filter(e => e.type === 'expense');
            const isFixed = (e: any) => {
              const sub = entrySubcategory(e);
              const subGroup = sub ? CATEGORY_META[sub as EntryCategory]?.group : null;
              // category guarda o group salvo (pode ter sido sobrescrito pelo usuário)
              return (e.category === 'fixed') || (!['fixed','variable','unexpected','taxa_plataforma','taxa_entrega'].includes(e.category) && subGroup === 'fixed');
            };
            const fixedList = monthExpenses.filter(isFixed);
            const variableList = monthExpenses.filter(e => !isFixed(e));
            const sumFixed = fixedList.reduce((s, e) => s + Number(e.amount), 0);
            const sumVar = variableList.reduce((s, e) => s + Number(e.amount), 0);
            const topFixed = [...fixedList].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 3);
            const topVar = [...variableList].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 3);
            const renderItem = (e: any) => {
              const sub = entrySubcategory(e);
              const meta = sub ? CATEGORY_META[sub as EntryCategory] : null;
              return (
                <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">{e.description || meta?.label || 'Sem descrição'}</span>
                  <span className="font-bold text-red-400 shrink-0">R${Number(e.amount).toFixed(2)}</span>
                </div>
              );
            };
            return (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <ArrowDownCircle className="h-4 w-4 text-red-400" /> Maiores saídas do mês
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-blue-400">📌 Fixas</p>
                      <p className="text-xs font-bold text-foreground">R${sumFixed.toFixed(2)}</p>
                    </div>
                    {topFixed.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">Nenhuma despesa fixa este mês.</p>
                    ) : topFixed.map(renderItem)}
                  </div>
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-purple-400">🎲 Avulsas</p>
                      <p className="text-xs font-bold text-foreground">R${sumVar.toFixed(2)}</p>
                    </div>
                    {topVar.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">Nenhuma despesa avulsa este mês.</p>
                    ) : topVar.map(renderItem)}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Marque "Fixa" ou "Avulsa" ao lançar uma saída em <strong>💸 Lançar</strong>.
                </p>
              </div>
            );
          })()}

          {/* Resumo rápido */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Hoje</p>
              <p className="text-lg font-bold text-foreground">R${todayRev.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground">{todayOrders.length} pedido(s)</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">Histórico geral</p>
              <p className="text-lg font-bold text-foreground">{validOrders.length}</p>
              <p className="text-[10px] text-muted-foreground">pedidos no total</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">A receber</p>
              <p className="text-lg font-bold text-green-400">R${(pendingRevenue + debtsToReceive).toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground">{pendingOrders.length} pedido(s) + cobranças</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">A pagar</p>
              <p className="text-lg font-bold text-red-400">R${debtsToPay.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground">contas em aberto</p>
            </div>
          </div>
        </div>
      )}

      {/* ====== FLUXO DE CAIXA ====== */}
      {tab === 'cashflow' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground mb-3">Últimos 6 meses</p>
            {(() => {
              const maxVal = Math.max(...cashflow.map(m => Math.max(m.income, m.expense)), 1);
              return (
                <div className="space-y-3">
                  {cashflow.map(m => (
                    <div key={m.key} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-foreground capitalize">{m.label}</span>
                        <span className={m.profit >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                          R${m.profit.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex gap-1 h-3">
                        <div className="flex-1 bg-secondary rounded overflow-hidden">
                          <div className="h-full bg-green-500 transition-all" style={{ width: `${(m.income / maxVal) * 100}%` }} />
                        </div>
                      </div>
                      <div className="flex gap-1 h-3">
                        <div className="flex-1 bg-secondary rounded overflow-hidden">
                          <div className="h-full bg-red-500 transition-all" style={{ width: `${(m.expense / maxVal) * 100}%` }} />
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>↑ R${m.income.toFixed(0)}</span>
                        <span>↓ R${m.expense.toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="flex gap-3 mt-3 text-xs">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> Entradas</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Saídas</span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Médias mensais (todo histórico)</p>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Entradas:</span><span className="text-green-400 font-medium">R${avgMonthlyRevenue.toFixed(2)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Saídas:</span><span className="text-red-400 font-medium">R${avgMonthlyExpense.toFixed(2)}</span></div>
            <div className="flex justify-between text-sm border-t border-border pt-2"><span className="text-foreground font-medium">Lucro médio:</span><span className={`font-bold ${avgMonthlyProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>R${avgMonthlyProfit.toFixed(2)}</span></div>
          </div>

          {/* Projeção (antiga aba 'Futuro' — agora junto do fluxo) */}
          <div className="rounded-xl border border-primary/30 bg-card p-4">
            <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Se continuar nesse ritmo...</p>
            <p className="text-xs text-muted-foreground mb-3">Baseado na média dos últimos {monthsActive} mês(es)</p>
            <div className="space-y-2">
              {[1, 3, 6, 12, 24, 60].map(m => {
                const proj = balance + (avgMonthlyProfit * m);
                const label = m < 12 ? `${m} mês${m > 1 ? 'es' : ''}` : `${m / 12} ano${m > 12 ? 's' : ''}`;
                return (
                  <div key={m} className="flex justify-between items-center rounded-lg bg-secondary p-3 text-sm">
                    <span className="text-muted-foreground">Em {label}</span>
                    <span className={`font-bold ${proj >= 0 ? 'text-green-400' : 'text-red-400'}`}>R${proj.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
            {avgMonthlyProfit < 0 && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-sm font-medium text-red-400">⚠️ Atenção</p>
                <p className="text-xs text-muted-foreground mt-1">Sua média mensal está negativa. Se nada mudar, seu saldo vai diminuir com o tempo. Reduza despesas ou aumente vendas.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== LANÇAMENTOS (categorizado e leigo-proof) ====== */}
      {tab === 'entries' && (
        <div className="space-y-3">
          <button onClick={() => setShowAddEntry(!showAddEntry)} className="flex items-center gap-2 w-full justify-center rounded-lg gradient-primary text-primary-foreground px-4 py-3 text-sm font-medium">
            <Plus className="h-4 w-4" /> Registrar entrada ou saída
          </button>

          {showAddEntry && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Escolha o tipo:</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(CATEGORY_META) as EntryCategory[]).map(key => {
                  const m = CATEGORY_META[key];
                  const Icon = m.icon;
                  const selected = ef.category === key;
                  return (
                    <button key={key} onClick={() => setEf({ ...ef, category: key })}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-all ${
                        selected
                          ? (m.type === 'income' ? 'border-green-500 bg-green-500/10' : 'border-red-500 bg-red-500/10')
                          : 'border-border bg-secondary hover:border-primary/30'
                      }`}>
                      <Icon className={`h-4 w-4 shrink-0 ${m.type === 'income' ? 'text-green-400' : 'text-red-400'}`} />
                      <span className="text-xs font-medium text-foreground truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                <input value={ef.amount} onChange={e => setEf({ ...ef, amount: e.target.value })} placeholder="0,00" type="number" step="0.01"
                  className="w-full rounded-lg border border-border bg-secondary pl-9 pr-3 py-3 text-base text-foreground font-medium" />
              </div>
              <input value={ef.description} onChange={e => setEf({ ...ef, description: e.target.value })}
                placeholder={`Descrição (opcional, ex: ${CATEGORY_META[ef.category].label})`}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />

              {/* Cartão de crédito — só faz sentido em despesa */}
              {CATEGORY_META[ef.category].type === 'expense' && (
                <button
                  type="button"
                  onClick={() => setEf({ ...ef, isCreditCard: !ef.isCreditCard })}
                  className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                    ef.isCreditCard ? 'border-orange-500 bg-orange-500/10' : 'border-border bg-secondary hover:border-orange-500/30'
                  }`}
                >
                  <div className={`h-5 w-9 rounded-full p-0.5 transition-colors ${ef.isCreditCard ? 'bg-orange-500' : 'bg-muted'}`}>
                    <div className={`h-4 w-4 rounded-full bg-white transition-transform ${ef.isCreditCard ? 'translate-x-4' : ''}`} />
                  </div>
                  <CreditCard className={`h-4 w-4 ${ef.isCreditCard ? 'text-orange-400' : 'text-muted-foreground'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">Foi no cartão de crédito?</p>
                    <p className="text-[10px] text-muted-foreground">
                      {ef.isCreditCard ? 'Vai pro saldo futuro até você marcar a fatura como paga' : 'Sai direto do saldo da conta'}
                    </p>
                  </div>
                </button>
              )}
              {/* Fixa vs Avulsa — só faz sentido em despesa */}
              {CATEGORY_META[ef.category].type === 'expense' && (
                <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Essa saída é fixa ou avulsa?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEf({ ...ef, expenseKind: 'fixed' })}
                      className={`rounded-lg border p-2 text-xs font-medium transition-all ${
                        (ef.expenseKind === 'auto' ? CATEGORY_META[ef.category].group === 'fixed' : ef.expenseKind === 'fixed')
                          ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      📌 Fixa <span className="block text-[9px] opacity-70 font-normal">repete todo mês (aluguel, salário…)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEf({ ...ef, expenseKind: 'variable' })}
                      className={`rounded-lg border p-2 text-xs font-medium transition-all ${
                        (ef.expenseKind === 'auto' ? CATEGORY_META[ef.category].group !== 'fixed' : ef.expenseKind === 'variable')
                          ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      🎲 Avulsa <span className="block text-[9px] opacity-70 font-normal">eventual (compra extra, conserto…)</span>
                    </button>
                  </div>
                </div>
              )}
              {/* Data de vencimento — só quando cartão ativo */}
              {CATEGORY_META[ef.category].type === 'expense' && ef.isCreditCard && (
                <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 space-y-1">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-orange-400" /> Quando vence essa fatura?
                  </label>
                  <input
                    type="date"
                    value={ef.dueDate}
                    onChange={e => setEf({ ...ef, dueDate: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                  />
                  <p className="text-[10px] text-muted-foreground">Vamos te lembrar 3 dias antes (em qualquer tela do painel).</p>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setShowAddEntry(false); setEditingEntryId(null); setEf({ category: 'sales', amount: '', description: '', isCreditCard: false, dueDate: '', expenseKind: 'auto' }); }} className="flex-1 rounded-lg bg-secondary text-muted-foreground px-3 py-2 text-sm">Cancelar</button>
                <button onClick={submitEntry} className="flex-1 rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-sm font-medium">{editingEntryId ? 'Atualizar' : 'Salvar'}</button>
              </div>
            </div>
          )}

          {entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Nenhum lançamento ainda.<br/>Toque acima para começar.</p>
          ) : (
            <div className="space-y-2">
              {entries.map(e => {
                const subKey = entrySubcategory(e as any);
                const subMeta = subKey ? CATEGORY_META[subKey as EntryCategory] : null;
                const SubIcon = subMeta?.icon;
                return (
                <div key={e.id} className="flex items-center justify-between rounded-lg bg-secondary p-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    {e.type === 'income' ? <ArrowUpCircle className="h-4 w-4 text-green-400 shrink-0" /> : <ArrowDownCircle className="h-4 w-4 text-red-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{e.description}</p>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        {SubIcon && <SubIcon className="h-3 w-3" />}
                        {subMeta?.label || (e.category as string)}
                        <span className="opacity-60">· {new Date(e.date).toLocaleDateString('pt-BR')}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-bold ${e.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                      {e.type === 'income' ? '+' : '-'}R${Number(e.amount).toFixed(2)}
                    </span>
                    <button onClick={() => startEditEntry(e)} className="text-muted-foreground hover:text-primary p-1" title="Editar">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={() => { if (confirm('Excluir este lançamento?')) delEntry.mutate(e.id); }} className="text-muted-foreground hover:text-destructive p-1" title="Excluir">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====== CARTÃO DE CRÉDITO ====== */}
      {tab === 'card' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-5 w-5 text-orange-400" />
              <p className="text-sm font-medium text-foreground">Fatura do cartão (em aberto)</p>
            </div>
            <p className="text-3xl font-extrabold text-orange-400">R${creditCardPending.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {creditCardEntries.length} {creditCardEntries.length === 1 ? 'compra' : 'compras'} · ainda não saiu da conta
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] text-muted-foreground">Na conta agora</p>
              <p className={`text-base font-bold ${accountBalance >= 0 ? 'text-foreground' : 'text-red-400'}`}>R${accountBalance.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
              <p className="text-[10px] text-muted-foreground">Disponível pra gastar</p>
              <p className={`text-base font-bold ${availableBalance >= 0 ? 'text-primary' : 'text-red-400'}`}>R${availableBalance.toFixed(2)}</p>
            </div>
          </div>

          {creditCardEntries.length > 0 && (
            <button
              onClick={() => setPayDialog({ entry: 'all', mode: 'full', amount: String(creditCardPending.toFixed(2)) })}
              className="w-full flex items-center justify-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-3 text-sm font-medium"
            >
              <Check className="h-4 w-4" /> Pagar fatura
            </button>
          )}

          <p className="text-xs text-muted-foreground px-1">
            💡 Para registrar uma nova compra no cartão, vá em <strong>💸 Lançar</strong> e ative o switch "Foi no cartão de crédito?".
          </p>

          {creditCardEntries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Nenhuma compra no cartão pendente. 🎉</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground px-1">Compras na fatura</p>
              {creditCardEntries.map((e: any) => {
                const subKey = entrySubcategory(e);
                const subMeta = subKey ? CATEGORY_META[subKey as EntryCategory] : null;
                const SubIcon = subMeta?.icon || CreditCard;
                const due = e.due_date ? new Date(e.due_date) : null;
                const overdue = due && due.getTime() < Date.now();
                const soon = due && !overdue && (due.getTime() - Date.now()) <= 3 * 86400000;
                return (
                  <div key={e.id} className={`flex items-center justify-between rounded-lg border p-3 text-sm ${
                    overdue ? 'border-red-500/40 bg-red-500/10' : soon ? 'border-yellow-500/40 bg-yellow-500/10' : 'border-orange-500/20 bg-orange-500/5'
                  }`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <SubIcon className={`h-4 w-4 shrink-0 ${overdue ? 'text-red-400' : soon ? 'text-yellow-400' : 'text-orange-400'}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{e.description}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {subMeta?.label || e.category} · {new Date(e.date).toLocaleDateString('pt-BR')}
                          {due && (
                            <span className={`ml-1 font-medium ${overdue ? 'text-red-400' : soon ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                              · vence {due.toLocaleDateString('pt-BR')}{overdue ? ' (VENCIDA)' : ''}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-orange-400">R${Number(e.amount).toFixed(2)}</span>
                      <button
                        onClick={() => setPayDialog({ entry: e, mode: 'full', amount: String(Number(e.amount).toFixed(2)) })}
                        className="rounded-md p-1 text-green-400 hover:bg-green-400/10"
                        title="Registrar pagamento"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Dialog: pagamento total ou parcial */}
          <Dialog open={!!payDialog.entry} onOpenChange={(o) => !o && setPayDialog({ entry: null, mode: 'full', amount: '' })}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>💳 Como você pagou?</DialogTitle>
                <DialogDescription>
                  {payDialog.entry === 'all'
                    ? `Fatura total: R$${creditCardPending.toFixed(2)}`
                    : payDialog.entry ? `${payDialog.entry.description} — R$${Number(payDialog.entry.amount).toFixed(2)}` : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPayDialog(p => ({ ...p, mode: 'full', amount: String(p.entry === 'all' ? creditCardPending.toFixed(2) : Number(p.entry?.amount || 0).toFixed(2)) }))}
                    className={`rounded-lg border p-3 text-sm font-medium ${payDialog.mode === 'full' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary text-muted-foreground'}`}
                  >
                    ✅ Paguei tudo
                  </button>
                  <button
                    onClick={() => setPayDialog(p => ({ ...p, mode: 'partial', amount: '' }))}
                    className={`rounded-lg border p-3 text-sm font-medium ${payDialog.mode === 'partial' ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400' : 'border-border bg-secondary text-muted-foreground'}`}
                  >
                    ⚠️ Paguei só uma parte
                  </button>
                </div>
                {payDialog.mode === 'partial' && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Quanto você pagou?</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        autoFocus
                        value={payDialog.amount}
                        onChange={e => setPayDialog(p => ({ ...p, amount: e.target.value }))}
                        placeholder="0,00"
                        className="w-full rounded-lg border border-border bg-secondary pl-9 pr-3 py-2 text-base text-foreground font-medium"
                      />
                    </div>
                    {(() => {
                      const total = payDialog.entry === 'all' ? creditCardPending : Number(payDialog.entry?.amount || 0);
                      const paid = Number(payDialog.amount || 0);
                      const remaining = Math.max(0, total - paid);
                      if (paid > 0) {
                        return (
                          <p className="text-xs text-muted-foreground">
                            Restante a pagar: <span className="font-bold text-orange-400">R${remaining.toFixed(2)}</span>
                            {paid > total && <span className="block text-red-400">Valor maior que o total — vai marcar como quitado.</span>}
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setPayDialog({ entry: null, mode: 'full', amount: '' })}
                    className="flex-1 rounded-lg bg-secondary text-muted-foreground px-3 py-2 text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={async () => {
                      const isAll = payDialog.entry === 'all';
                      const targets: any[] = isAll ? creditCardEntries : [payDialog.entry];
                      const total = isAll ? creditCardPending : Number(payDialog.entry?.amount || 0);
                      const paidAmt = payDialog.mode === 'full' ? total : Number(payDialog.amount || 0);
                      if (paidAmt <= 0) { toast.error('Informe o valor pago'); return; }

                      // Marca todas as entradas-alvo como pagas
                      const ids = targets.map(t => t.id);
                      const { error: e1 } = await supabase
                        .from('financial_entries')
                        .update({ paid: true, paid_at: new Date().toISOString() } as any)
                        .in('id', ids);
                      if (e1) { toast.error('Erro ao registrar pagamento'); return; }

                      // Se foi parcial, cria nova entrada de despesa-cartão com o restante (mantém saldo futuro correto)
                      const remaining = total - paidAmt;
                      if (remaining > 0.005) {
                        const ref = isAll ? null : payDialog.entry;
                        const desc = isAll
                          ? `Saldo restante da fatura (R$${remaining.toFixed(2)})`
                          : `${ref.description} — saldo restante`;
                        const { error: e2 } = await supabase.from('financial_entries').insert({
                          tenant_id: tenantId,
                          type: 'expense',
                          amount: remaining,
                          description: desc,
                          category: ref?.category || 'variable',
                          subcategory: ref?.subcategory || null,
                          is_credit_card: true,
                          paid: false,
                          due_date: ref?.due_date || null,
                          date: new Date().toISOString(),
                        } as any);
                        if (e2) { toast.error('Erro ao registrar saldo restante'); return; }
                        toast.success(`Pago R$${paidAmt.toFixed(2)}. Restou R$${remaining.toFixed(2)} no cartão.`);
                      } else {
                        toast.success(`✅ Quitado: R$${paidAmt.toFixed(2)}`);
                      }

                      setPayDialog({ entry: null, mode: 'full', amount: '' });
                      setTimeout(() => window.location.reload(), 400);
                    }}
                    className="flex-1 rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-sm font-medium"
                  >
                    Confirmar pagamento
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ====== A PAGAR / RECEBER (Contas + Fiado num só lugar) ====== */}
      {tab === 'debts' && (
        <div className="space-y-3">
          {/* Toggle interno: Contas (genérico) vs Fiado (clientes) */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDebtsView('contas')}
              className={`rounded-lg border p-2.5 text-xs font-medium transition-all ${
                debtsView === 'contas'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              📋 Contas (geral)
            </button>
            <button
              onClick={() => setDebtsView('fiado')}
              className={`rounded-lg border p-2.5 text-xs font-medium transition-all ${
                debtsView === 'fiado'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              🤝 Fiado (clientes)
            </button>
          </div>

          {debtsView === 'fiado' ? (
            <FiadoTab tenantId={tenantId} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-xs text-muted-foreground">Você deve</p>
                  <p className="text-lg font-bold text-red-400">R${debtsToPay.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                  <p className="text-xs text-muted-foreground">Vão te pagar</p>
                  <p className="text-lg font-bold text-green-400">R${debtsToReceive.toFixed(2)}</p>
                </div>
              </div>

              <button onClick={() => setShowAddDebt(!showAddDebt)} className="flex items-center gap-2 w-full justify-center rounded-lg gradient-primary text-primary-foreground px-4 py-3 text-sm font-medium">
                <Plus className="h-4 w-4" /> Adicionar conta
              </button>

              {showAddDebt && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setDf({ ...df, type: 'payable' })}
                      className={`rounded-lg border p-3 text-sm transition-all ${df.type === 'payable' ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-border bg-secondary text-muted-foreground'}`}>
                      📋 Eu devo
                    </button>
                    <button onClick={() => setDf({ ...df, type: 'receivable' })}
                      className={`rounded-lg border p-3 text-sm transition-all ${df.type === 'receivable' ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-border bg-secondary text-muted-foreground'}`}>
                      💰 Vão me pagar
                    </button>
                  </div>
                  <input value={df.name} onChange={e => setDf({ ...df, name: e.target.value })}
                    placeholder="Para quem? (ex: Aluguel, João Silva)"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                    <input value={df.amount} onChange={e => setDf({ ...df, amount: e.target.value })} placeholder="0,00" type="number"
                      className="w-full rounded-lg border border-border bg-secondary pl-9 pr-3 py-2 text-sm text-foreground" />
                  </div>
                  <input value={df.dueDate} onChange={e => setDf({ ...df, dueDate: e.target.value })} type="date"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                  <div className="flex gap-2">
                    <button onClick={() => setShowAddDebt(false)} className="flex-1 rounded-lg bg-secondary text-muted-foreground px-3 py-2 text-sm">Cancelar</button>
                    <button onClick={submitDebt} className="flex-1 rounded-lg gradient-primary text-primary-foreground px-3 py-2 text-sm font-medium">Salvar</button>
                  </div>
                </div>
              )}

              {debts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">Nenhuma conta cadastrada.</p>
              ) : (
                <div className="space-y-2">
                  {debts.map(d => {
                    const isPayable = isPayableType(d.type);
                    const overdue = !d.paid && d.due_date && new Date(d.due_date) < new Date();
                    return (
                      <div key={d.id} className={`flex items-center justify-between rounded-lg p-3 text-sm ${
                        d.paid ? 'bg-green-900/10' : overdue ? 'bg-red-500/15 border border-red-500/30' : 'bg-secondary'
                      }`}>
                        <div className="min-w-0">
                          <p className={`font-medium truncate ${d.paid ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{d.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {isPayable ? '📋 A pagar' : '💰 A receber'}
                            {d.due_date && ` · vence ${new Date(d.due_date).toLocaleDateString('pt-BR')}`}
                            {overdue && <span className="text-red-400 font-bold ml-1">VENCIDA</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`font-bold ${isPayable ? 'text-red-400' : 'text-green-400'}`}>R${Number(d.amount).toFixed(2)}</span>
                          {!d.paid && <button onClick={() => updateDebt.mutate({ ...d, paid: true })} className="rounded-md p-1 text-green-400 hover:bg-green-400/10" title="Marcar como pago"><Check className="h-4 w-4" /></button>}
                          <button onClick={() => delDebt.mutate(d.id)} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ====== FORNECEDORES ====== */}
      {tab === 'suppliers' && (
        <div className="space-y-3">
          {/* Botão de lançamento manual */}
          <button
            onClick={() => setShowAddSupplierDebt(v => !v)}
            className="flex items-center gap-2 w-full justify-center rounded-lg gradient-primary text-primary-foreground px-4 py-3 text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> {showAddSupplierDebt ? 'Cancelar' : 'Lançar dívida com fornecedor'}
          </button>

          {showAddSupplierDebt && (
            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
              {suppliers.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Você ainda não cadastrou fornecedores. Vá em <strong>Fornecedores</strong> no menu pra cadastrar.
                </p>
              ) : (
                <>
                  <select
                    value={sdf.supplierId}
                    onChange={e => setSdf({ ...sdf, supplierId: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">Selecione o fornecedor</option>
                    {suppliers.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input
                    value={sdf.description}
                    onChange={e => setSdf({ ...sdf, description: e.target.value })}
                    placeholder="Descrição (ex: 50 caixas de cerveja)"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={sdf.amount}
                      onChange={e => setSdf({ ...sdf, amount: e.target.value })}
                      type="number" step="0.01" placeholder="0,00"
                      className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                    <input
                      value={sdf.dueDate}
                      onChange={e => setSdf({ ...sdf, dueDate: e.target.value })}
                      type="date"
                      className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (!sdf.supplierId || !sdf.description || !sdf.amount || Number(sdf.amount) <= 0) {
                        toast.error('Preencha fornecedor, descrição e valor');
                        return;
                      }
                      addDebt.mutate({
                        tenant_id: tenantId,
                        name: `${SUPPLIER_DEBT_PREFIX}${sdf.supplierId}::${sdf.description}`,
                        amount: parseFloat(sdf.amount),
                        due_date: sdf.dueDate || null,
                        paid: false,
                        type: 'owe',
                      } as any, {
                        onSuccess: () => {
                          toast.success('🏭 Dívida com fornecedor registrada');
                          setSdf({ supplierId: '', description: '', amount: '', dueDate: '' });
                          setShowAddSupplierDebt(false);
                        },
                        onError: () => toast.error('Erro ao salvar'),
                      });
                    }}
                    className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-medium"
                  >
                    Salvar dívida
                  </button>
                </>
              )}
            </div>
          )}

          {supplierSummary.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              Nenhuma movimentação com fornecedor ainda.<br/>
              <span className="text-xs">Lance uma dívida acima ou venda produtos com fornecedor associado.</span>
            </p>
          ) : (
            <>
              {supplierSummary.map((s, i) => {
                const totalDevo = s.totalCost + s.manualDebt;
                return (
                  <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center gap-2"><Factory className="h-4 w-4 text-primary" /><span className="font-medium text-foreground">{s.name}</span></div>
                    {s.orderCount > 0 && (
                      <>
                        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Itens vendidos:</span><span className="text-foreground">{s.orderCount}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total vendido:</span><span className="text-green-400">R${s.totalSale.toFixed(2)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Custo dos pedidos:</span><span className="text-red-400">R${s.totalCost.toFixed(2)}</span></div>
                      </>
                    )}
                    {s.manualDebt > 0 && (
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Dívidas lançadas:</span><span className="text-red-400">R${s.manualDebt.toFixed(2)}</span></div>
                    )}
                    {s.manualPaid > 0 && (
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Já pago:</span><span className="text-green-400">R${s.manualPaid.toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between text-sm border-t border-border pt-1"><span className="text-foreground font-medium">Devo no total:</span><span className="font-bold text-red-400">R${totalDevo.toFixed(2)}</span></div>
                    {s.totalSale > 0 && (
                      <div className="flex justify-between text-sm"><span className="text-foreground font-medium">Lucro nos pedidos:</span><span className={`font-bold ${(s.totalSale - s.totalCost) >= 0 ? 'text-green-400' : 'text-red-400'}`}>R${(s.totalSale - s.totalCost).toFixed(2)}</span></div>
                    )}
                  </div>
                );
              })}

              {/* Lista de dívidas manuais ainda em aberto */}
              {supplierManualDebts.filter(d => !d.paid).length > 0 && (
                <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <p className="text-sm font-medium text-foreground">📋 Dívidas em aberto</p>
                  {supplierManualDebts.filter(d => !d.paid).map(d => {
                    const parsed = parseSupplierDebt(d.name)!;
                    const sup = suppliers.find((s: any) => s.id === parsed.supplierId);
                    const overdue = d.due_date && new Date(d.due_date) < new Date();
                    return (
                      <div key={d.id} className={`flex items-center justify-between rounded-lg p-2 text-sm ${overdue ? 'bg-red-500/15 border border-red-500/30' : 'bg-secondary'}`}>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{parsed.description}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {sup?.name || 'Fornecedor'}
                            {d.due_date && ` · vence ${new Date(d.due_date).toLocaleDateString('pt-BR')}`}
                            {overdue && <span className="text-red-400 font-bold ml-1">VENCIDA</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold text-red-400">R${Number(d.amount).toFixed(2)}</span>
                          <button onClick={() => updateDebt.mutate({ ...d, paid: true })} className="rounded-md p-1 text-green-400 hover:bg-green-400/10" title="Marcar como pago"><Check className="h-4 w-4" /></button>
                          <button onClick={() => delDebt.mutate(d.id)} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">Totais</p>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Devo no total:</span><span className="text-red-400 font-bold">R${totalSupplierCost.toFixed(2)}</span></div>
                {totalSupplierSale > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Lucro nos pedidos:</span><span className={`font-bold ${dropshippingProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>R${dropshippingProfit.toFixed(2)}</span></div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* (Aba 'projection' foi mesclada dentro do Fluxo; aba 'fiado' agora vive dentro do toggle de 'debts') */}

      {tab === 'fee_config' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Como a taxa da plataforma é cobrada?</span>
            </div>
            <div className="space-y-2">
              {[
                { value: 'margin', label: '💰 Sai do meu bolso', desc: 'O cliente paga o preço normal. Você paga a taxa do seu lucro.' },
                { value: 'price', label: '🏷️ Embuto no preço', desc: 'A taxa é somada ao preço final do cliente.' },
                { value: 'split', label: '⚖️ Dividida', desc: 'Parte sai do seu bolso, parte vai pro cliente.' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setFeeMode(opt.value)}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${feeMode === opt.value ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-primary/30'}`}>
                  <span className="text-sm font-medium text-foreground">{opt.label}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
            {feeMode === 'split' && (
              <div className="rounded-lg border border-border bg-secondary p-3 space-y-2">
                <label className="text-sm font-medium text-foreground">Quanto % da taxa você paga?</label>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={100} step={5} value={feeSplitPercent}
                    onChange={e => setFeeSplitPercent(Number(e.target.value))} className="flex-1 accent-primary" />
                  <span className="text-sm font-bold text-primary w-12 text-right">{feeSplitPercent}%</span>
                </div>
                <p className="text-xs text-muted-foreground">Você: {feeSplitPercent}% · Cliente: {100 - feeSplitPercent}%</p>
              </div>
            )}
            <button onClick={saveFeeConfig} disabled={savingFee}
              className="flex items-center gap-2 w-full justify-center rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {savingFee ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          </div>
        </div>
      )}

      {/* ====== CLARA — Painel empresarial nativo (visualização + IA) ====== */}
      {tab === 'clara' && (
        <TenantBusinessPanel tenantId={tenantId} tenantName={''} />
      )}
    </div>
  );
};

export default TenantFinancialManager;
