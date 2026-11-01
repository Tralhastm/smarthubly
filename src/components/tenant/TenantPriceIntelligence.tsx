/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlertCircle, Calculator, CheckCircle2, Clipboard, Download, ExternalLink, FileDown,
  FileText, History, Loader2, Plus, Radar, Search, Settings2, Trash2, Upload,
} from 'lucide-react';
import {
  calculatePricing, MINIMUM_COMPARABLE_EVIDENCE, normalizeProductName, parseSupplierText, roundMoney, toCsv,
  type ParsedSupplierItem, type PricerDecision, type PricerExpense,
} from '@/lib/market-pricer';

interface Props { tenantId: string }
type CatalogProduct = { id: string; name: string; original_price: number | null };
type MarketQualityStatus = 'approved' | 'insufficient_evidence' | 'suspect';
type MarketEvidence = { source: string; title: string; price: number | null; url: string | null; condition: string; collected_at: string; status: 'comparable' | 'indicative' | 'rejected'; acceptance_reason: string | null; rejection_reason: string | null };
type MarketResearchItem = { name: string; min: number | null; median: number | null; max: number | null; evidence_count: number; indicative_count?: number; found_count?: number; rejected_count?: number; quality_status?: MarketQualityStatus; quality_note?: string; demand_note?: string; search_rounds?: number; sources?: MarketEvidence[] };
type StoredPricerExpense = PricerExpense & { id: string; created_at: string; amount_type: 'percentage' | 'fixed'; product_id: string | null };
type PricedItem = ParsedSupplierItem & {
  productId: string | null;
  marketMin: number | null;
  marketMedian: number | null;
  marketMax: number | null;
  evidenceCount: number;
  indicativeCount: number;
  foundCount: number;
  rejectedCount: number;
  qualityStatus: MarketQualityStatus;
  qualityNote: string;
  demandNote: string;
  sources: MarketEvidence[];
  pricing: ReturnType<typeof calculatePricing> | null;
};
type HistoryRow = { id: string; input_name: string | null; status: string; minimum_profit: number; totals: any; created_at: string };

const DEFAULT_EXPENSES: PricerExpense[] = [
  { label: 'Taxa sobre a venda', amountType: 'percentage', amount: 4.99, enabled: true },
  { label: 'Motoboy', amountType: 'fixed', amount: 50, enabled: true },
];
const money = (value: number | null | undefined) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const approvedMoney = (value: number | null | undefined) => value == null ? 'Não aprovado' : money(value);
const approvedPercent = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(2)}%`;
const dateBR = (value: string) => new Date(value).toLocaleString('pt-BR');
const decisionLabel: Record<PricerDecision, string> = { 'carro-chefe': 'Carro-chefe', 'margem-segura': 'Margem segura', inconclusivo: 'Inconclusivo' };
const decisionClass: Record<PricerDecision, string> = {
  'carro-chefe': 'border-green-500/30 bg-green-500/10 text-green-500',
  'margem-segura': 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  inconclusivo: 'border-destructive/30 bg-destructive/10 text-destructive',
};
const qualityLabel: Record<MarketQualityStatus, string> = { approved: 'Referência aprovada', insufficient_evidence: 'Evidência insuficiente', suspect: 'Referência suspeita' };
const qualityClass: Record<MarketQualityStatus, string> = {
  approved: 'border-green-500/30 bg-green-500/10 text-green-500',
  insufficient_evidence: 'border-destructive/30 bg-destructive/10 text-destructive',
  suspect: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
};
const sourceStatusLabel = (status: MarketEvidence['status']) => status === 'comparable' ? 'APROVADO' : status === 'indicative' ? 'INDICATIVO' : 'REJEITADO';

function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsText(file);
  });
}

export default function TenantPriceIntelligence({ tenantId }: Props) {
  const [subTab, setSubTab] = useState<'analysis' | 'expenses' | 'history'>('analysis');
  const [inputText, setInputText] = useState('');
  const [inputName, setInputName] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [minimumProfit, setMinimumProfit] = useState('100');
  const [results, setResults] = useState<PricedItem[]>([]);
  const [researching, setResearching] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ label: '', amountType: 'percentage' as 'percentage' | 'fixed', amount: '', productId: '' });
  const seededDefaults = useRef(false);

  const catalogQuery = useQuery({
    queryKey: ['market-pricer-catalog', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,original_price').eq('tenant_id', tenantId).order('name').limit(3000);
      if (error) throw error;
      return (data || []) as CatalogProduct[];
    },
  });
  const expensesQuery = useQuery({
    queryKey: ['market-pricer-expenses', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('market_pricer_expenses' as any).select('id,label,amount_type,amount,enabled,product_id,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: true }).limit(500);
      if (error) throw error;
      return (data || []) as unknown as StoredPricerExpense[];
    },
  });
  const historyQuery = useQuery({
    queryKey: ['market-pricer-history', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('market_pricer_analyses' as any).select('id,input_name,status,minimum_profit,totals,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as unknown as HistoryRow[];
    },
  });

  const expenses = useMemo(() => (expensesQuery.data || []).map(expense => ({
    ...expense,
    amountType: (expense as any).amount_type as 'percentage' | 'fixed',
    productId: (expense as any).product_id || null,
  })) as PricerExpense[], [expensesQuery.data]);
  const parsedItems = useMemo(() => parseSupplierText(inputText), [inputText]);
  const candidateItems = useMemo(() => {
    const catalog = catalogQuery.data || [];
    return parsedItems.map(item => {
      const catalogMatch = catalog.find(product => normalizeProductName(product.name) === item.key);
      const supplierCost = item.supplierCost ?? (catalogMatch?.original_price ? Number(catalogMatch.original_price) : null);
      return {
        ...item,
        productId: catalogMatch?.id || null,
        supplierCost,
        costWarning: item.costWarning || (supplierCost != null && supplierCost > 0 && supplierCost < 10 ? 'Custo suspeito: confirme o separador de milhar.' : null),
      };
    });
  }, [catalogQuery.data, parsedItems]);
  const selectedItems = useMemo(() => candidateItems.filter(item => selectedKeys.includes(item.key)).slice(0, 53), [candidateItems, selectedKeys]);

  useEffect(() => {
    if (!candidateItems.length) {
      setSelectedKeys([]);
      return;
    }
    setSelectedKeys(previous => {
      const existing = previous.filter(key => candidateItems.some(item => item.key === key));
      return existing.length ? existing.slice(0, 53) : candidateItems.slice(0, 53).map(item => item.key);
    });
  }, [candidateItems]);

  useEffect(() => {
    if (expensesQuery.data && expensesQuery.data.length === 0 && !seededDefaults.current) {
      seededDefaults.current = true;
      void (async () => {
        const { error } = await supabase.from('market_pricer_expenses' as any).insert(DEFAULT_EXPENSES.map(expense => ({ tenant_id: tenantId, label: expense.label, amount_type: expense.amountType, amount: expense.amount, enabled: true })));
        if (!error) await expensesQuery.refetch();
      })();
    }
  }, [expensesQuery, expensesQuery.data, tenantId]);

  const totals = useMemo(() => ({
    count: results.length,
    cost: roundMoney(results.reduce((sum, item) => sum + (item.supplierCost || 0), 0)),
    revenue: roundMoney(results.reduce((sum, item) => sum + (item.pricing?.minimumPrice || 0), 0)),
    recommendedRevenue: roundMoney(results.reduce((sum, item) => sum + (item.pricing?.marketRecommendedPrice || 0), 0)),
    profit: roundMoney(results.reduce((sum, item) => sum + (item.pricing?.netProfit || 0), 0)),
    marketProfit: roundMoney(results.reduce((sum, item) => sum + (item.pricing?.marketNetProfit || 0), 0)),
    stars: results.filter(item => item.pricing?.decision === 'carro-chefe').length,
    safe: results.filter(item => item.pricing?.decision === 'margem-segura').length,
    inconclusive: results.filter(item => item.pricing?.decision === 'inconclusivo').length,
  }), [results]);

  const addExpense = async () => {
    const amount = Number(expenseForm.amount.replace(',', '.'));
    if (!expenseForm.label.trim()) return toast.error('Informe o nome do gasto.');
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Informe um valor maior que zero.');
    setSavingExpense(true);
    const { error } = await supabase.from('market_pricer_expenses' as any).insert({
      tenant_id: tenantId,
      label: expenseForm.label.trim(),
      amount_type: expenseForm.amountType,
      amount,
      enabled: true,
      product_id: expenseForm.productId || null,
    });
    setSavingExpense(false);
    if (error) return toast.error(error.message);
    toast.success('Gasto salvo. Ele será usado nas próximas análises.');
    setExpenseForm({ label: '', amountType: 'percentage', amount: '', productId: '' });
    await expensesQuery.refetch();
  };

  const toggleExpense = async (expense: PricerExpense & { id?: string }) => {
    if (!expense.id) return;
    const { error } = await supabase.from('market_pricer_expenses' as any).update({ enabled: !expense.enabled }).eq('id', expense.id).eq('tenant_id', tenantId);
    if (error) toast.error(error.message); else await expensesQuery.refetch();
  };

  const removeExpense = async (expense: PricerExpense & { id?: string }) => {
    if (!expense.id || !confirm(`Remover o gasto “${expense.label}”?`)) return;
    const { error } = await supabase.from('market_pricer_expenses' as any).delete().eq('id', expense.id).eq('tenant_id', tenantId);
    if (error) toast.error(error.message); else await expensesQuery.refetch();
  };

  const analyze = async () => {
    if (!selectedItems.length) return toast.error('Cole uma lista e selecione pelo menos um produto.');
    if (selectedItems.some(item => !item.supplierCost || item.supplierCost <= 0)) return toast.error('Há produto sem custo. Corrija a lista ou cadastre o custo no catálogo antes da pesquisa.');
    if (selectedItems.some(item => item.costWarning)) return toast.error('Há custo suspeito abaixo de R$ 10. Confirme os separadores de milhar antes de pesquisar.');
    setResearching(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke('market-price-research', { body: { tenantId, items: selectedItems.map(item => ({ name: item.name })) } });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'A pesquisa de mercado falhou.');
      const marketItems = (data.items || []) as MarketResearchItem[];
      const marketByName = new Map<string, MarketResearchItem>(marketItems.map(item => [normalizeProductName(item.name), item] as const));
      const minProfit = Math.max(0, Number(minimumProfit.replace(',', '.')) || 0);
      const calculated: PricedItem[] = selectedItems.map(item => {
        const market = marketByName.get(item.key) || {} as MarketResearchItem;
        const itemExpenses = expenses.map(expense => ({ ...expense, productId: expense.productId || null }));
        const validQualityStatuses: MarketQualityStatus[] = ['approved', 'insufficient_evidence', 'suspect'];
        const qualityStatus: MarketQualityStatus = validQualityStatuses.includes(market.quality_status) ? market.quality_status : 'insufficient_evidence';
        const evidenceCount = Number(market.evidence_count) || 0;
        const pricing = calculatePricing(Number(item.supplierCost), itemExpenses, Number(market.median), minProfit, item.productId, evidenceCount, qualityStatus);
        return {
          ...item,
          marketMin: Number.isFinite(Number(market.min)) && Number(market.min) > 0 ? Number(market.min) : null,
          marketMedian: Number.isFinite(Number(market.median)) && Number(market.median) > 0 ? Number(market.median) : null,
          marketMax: Number.isFinite(Number(market.max)) && Number(market.max) > 0 ? Number(market.max) : null,
          evidenceCount,
          indicativeCount: Number(market.indicative_count) || 0,
          foundCount: Number(market.found_count) || 0,
          rejectedCount: Number(market.rejected_count) || 0,
          qualityStatus,
          qualityNote: String(market.quality_note || 'A pesquisa não confirmou evidências suficientes para aprovar a referência.'),
          demandNote: String(market.demand_note || 'Demanda estimada; não há volume público confirmado.'),
          sources: (market.sources || []) as MarketEvidence[],
          pricing,
        };
      });
      const analysisInsert = await supabase.from('market_pricer_analyses' as any).insert({
        tenant_id: tenantId,
        input_name: inputName.trim() || 'Lista de fornecedores',
        source_text: inputText,
        selected_limit: selectedItems.length,
        minimum_profit: minProfit,
        expenses_snapshot: expenses,
        totals: { count: calculated.length, cost: calculated.reduce((sum, item) => sum + Number(item.supplierCost || 0), 0), minimum_viable_revenue: calculated.reduce((sum, item) => sum + Number(item.pricing?.minimumPrice || 0), 0), recommended_market_revenue: calculated.reduce((sum, item) => sum + Number(item.pricing?.marketRecommendedPrice || 0), 0), minimum_profit: calculated.reduce((sum, item) => sum + Number(item.pricing?.netProfit || 0), 0), market_profit: calculated.reduce((sum, item) => sum + Number(item.pricing?.marketNetProfit || 0), 0), evidence_found: calculated.reduce((sum, item) => sum + item.foundCount, 0), evidence_comparable: calculated.reduce((sum, item) => sum + item.evidenceCount, 0), evidence_indicative: calculated.reduce((sum, item) => sum + item.indicativeCount, 0), evidence_rejected: calculated.reduce((sum, item) => sum + item.rejectedCount, 0) },
        status: calculated.every(item => item.qualityStatus === 'approved') ? 'completed' : 'partial',
      }).select('id').single();
      if (analysisInsert.error) throw analysisInsert.error;
      const analysisId = (analysisInsert.data as unknown as { id: string } | null)?.id;
      if (!analysisId) throw new Error('Não foi possível identificar a análise salva.');
      const rows = calculated.map(item => ({
        analysis_id: analysisId,
        tenant_id: tenantId,
        product_name: item.name,
        normalized_name: item.key,
        supplier_cost: item.supplierCost,
        cost_warning: item.costWarning,
        occurrences: item.occurrences,
        market_min: item.marketMin,
        market_median: item.marketMedian,
        market_max: item.marketMax,
        evidence_count: item.evidenceCount,
        evidence_indicative_count: item.indicativeCount,
        evidence_found_count: item.foundCount,
        evidence_rejected_count: item.rejectedCount,
        quality_status: item.qualityStatus,
        quality_note: item.qualityNote,
        demand_note: item.demandNote,
        minimum_price: item.pricing?.minimumPrice || null,
        recommended_market_price: item.pricing?.marketRecommendedPrice || null,
        suggested_price: item.pricing?.marketRecommendedPrice || item.pricing?.minimumPrice || null,
        fixed_expenses: item.pricing?.fixedExpenses || 0,
        percentage_expenses: item.pricing?.percentageExpenses || 0,
        net_profit: item.pricing?.netProfit || null,
        margin_percent: item.pricing?.marginPercent || null,
        market_net_profit: item.pricing?.marketNetProfit || null,
        market_margin_percent: item.pricing?.marketMarginPercent || null,
        decision: item.pricing?.decision || 'inconclusivo',
        evidence_status: item.qualityStatus === 'approved' ? 'suficiente' : item.indicativeCount > 0 ? 'indicativo' : 'inconclusivo',
      }));
      const itemInsert = await supabase.from('market_pricer_items' as any).insert(rows).select('id,product_name');
      if (itemInsert.error) throw itemInsert.error;
      const insertedItems = (itemInsert.data || []) as unknown as Array<{ id: string; product_name: string }>;
      const idByName = new Map<string, string>(insertedItems.map(row => [normalizeProductName(row.product_name), row.id] as const));
      const sourceRows = calculated.flatMap(item => (item.sources || []).filter(source => source.price != null && !!source.url).map(source => ({ analysis_item_id: idByName.get(item.key), tenant_id: tenantId, source: source.source, title: source.title, price: source.price, url: source.url, condition: source.condition, status: source.status, acceptance_reason: source.acceptance_reason, rejection_reason: source.rejection_reason, collected_at: source.collected_at }))).filter(row => row.analysis_item_id);
      if (sourceRows.length) {
        const sourceInsert = await supabase.from('market_pricer_sources' as any).insert(sourceRows);
        if (sourceInsert.error) throw sourceInsert.error;
      }
      setResults(calculated);
      await historyQuery.refetch();
      toast.success(`Análise concluída: ${calculated.length} produtos processados.`);
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível concluir a pesquisa.');
    } finally {
      setResearching(false);
    }
  };

  const exportCsv = () => {
    if (!results.length) return toast.info('Faça uma análise antes de exportar.');
    const rows = results.map(item => ({
      Produto: item.name,
      Ocorrencias: item.occurrences,
      'Custo fornecedor': money(item.supplierCost),
      'Gastos fixos': money(item.pricing?.fixedExpenses),
      'Taxas percentuais': `${item.pricing?.percentageExpenses || 0}%`,
      'Mercado minimo': money(item.marketMin),
      'Mercado mediano': money(item.marketMedian),
      'Preco minimo viavel': money(item.pricing?.minimumPrice),
      'Preco recomendado de mercado': money(item.pricing?.marketRecommendedPrice),
      'Lucro no minimo viavel': money(item.pricing?.netProfit),
      'Margem no minimo viavel': `${item.pricing?.marginPercent || 0}%`,
      'Lucro no mercado aprovado': approvedMoney(item.pricing?.marketNetProfit),
      'Margem no mercado aprovado': approvedPercent(item.pricing?.marketMarginPercent),
      Decisao: item.pricing ? decisionLabel[item.pricing.decision] : 'Inconclusivo',
      Anuncios_encontrados: item.foundCount,
      Anuncios_comparaveis: item.evidenceCount,
      Anuncios_indicativos: item.indicativeCount,
      Anuncios_rejeitados: item.rejectedCount,
      Qualidade_da_referencia: item.qualityStatus,
      Justificativa_da_qualidade: item.qualityNote,
      Evidencias_detalhadas: item.sources.map(source => `${sourceStatusLabel(source.status)}: ${source.title} | ${source.price == null ? 'sem preço' : money(source.price)} | ${source.url || 'sem link'} | ${source.rejection_reason || source.acceptance_reason || 'sem justificativa'}`).join(' || '),
    }));
    const csv = toCsv(rows);
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'precificador-mercado.csv'; anchor.click(); URL.revokeObjectURL(url);
  };

  const exportText = () => {
    if (!results.length) return toast.info('Faça uma análise antes de exportar.');
    const lines = [
      'PRECIFICADOR DE MERCADO',
      `Análise: ${inputName.trim() || 'Lista de fornecedores'}`,
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
      `Produtos: ${totals.count} | Custo: ${money(totals.cost)} | Mínimo viável: ${money(totals.revenue)} | Mercado aprovado: ${money(totals.recommendedRevenue)} | Lucro mínimo: ${money(totals.profit)} | Lucro no mercado: ${money(totals.marketProfit)}`,
      '',
      ...results.flatMap(item => [
        `Produto: ${item.name}`,
        `Ocorrências: ${item.occurrences}`,
        `Custo fornecedor: ${money(item.supplierCost)}`,
        `Mercado: ${item.marketMedian ? `${money(item.marketMin)} a ${money(item.marketMax)} (mediana ${money(item.marketMedian)})` : 'Sem evidência'}`,
        `Preço mínimo viável: ${money(item.pricing?.minimumPrice)} | Preço recomendado de mercado: ${money(item.pricing?.marketRecommendedPrice)}`,
        `Lucro no mínimo viável: ${money(item.pricing?.netProfit)} | Margem: ${(item.pricing?.marginPercent || 0).toFixed(2)}%`,
        `Lucro no mercado aprovado: ${approvedMoney(item.pricing?.marketNetProfit)} | Margem: ${approvedPercent(item.pricing?.marketMarginPercent)}`,
        `Decisão: ${item.pricing ? decisionLabel[item.pricing.decision] : 'Inconclusivo'} | Anúncios: ${item.foundCount} encontrados, ${item.evidenceCount} aprovados, ${item.indicativeCount} indicativos, ${item.rejectedCount} rejeitados`,
        `Qualidade: ${item.qualityStatus} — ${item.qualityNote}`,
        ...(item.sources.length ? item.sources.map(source => `${sourceStatusLabel(source.status)}: ${source.title} | ${source.price == null ? 'sem preço' : money(source.price)} | ${source.url || 'sem link'}${source.rejection_reason ? ` | Motivo: ${source.rejection_reason}` : source.acceptance_reason ? ` | Motivo: ${source.acceptance_reason}` : ''}`) : ['Fonte: Pesquisa inconclusiva']),
        '',
      ]),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'precificador-mercado.txt'; anchor.click(); URL.revokeObjectURL(url);
  };

  const copyText = async () => {
    if (!results.length) return toast.info('Faça uma análise antes de copiar.');
    const lines = results.map(item => [
      item.name,
      `Custo: ${money(item.supplierCost)} | Mínimo viável: ${money(item.pricing?.minimumPrice)} | Mercado aprovado: ${approvedMoney(item.pricing?.marketRecommendedPrice)} | Lucro mínimo: ${money(item.pricing?.netProfit)} (${(item.pricing?.marginPercent || 0).toFixed(2)}%) | Lucro no mercado: ${approvedMoney(item.pricing?.marketNetProfit)} (${approvedPercent(item.pricing?.marketMarginPercent)})`,
      `Decisão: ${item.pricing ? decisionLabel[item.pricing.decision] : 'Inconclusivo'} | Anúncios: ${item.foundCount} encontrados, ${item.evidenceCount} aprovados, ${item.indicativeCount} indicativos, ${item.rejectedCount} rejeitados`,
      `Qualidade: ${item.qualityStatus} — ${item.qualityNote}`,
      ...item.sources.map(source => `${sourceStatusLabel(source.status)}: ${source.title} | ${source.price == null ? 'sem preço' : money(source.price)} | ${source.url || 'sem link'} | ${source.rejection_reason || source.acceptance_reason || 'sem justificativa'}`),
    ].join('\n')).join('\n\n');
    try {
      await navigator.clipboard.writeText(lines);
      toast.success('Resultado copiado para o clipboard.');
    } catch {
      toast.error('Não foi possível acessar o clipboard neste navegador.');
    }
  };

  const exportPdf = () => {
    if (!results.length) return toast.info('Faça uma análise antes de exportar.');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Precificador de Mercado', pageWidth / 2, 42, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(`Análise: ${inputName.trim() || 'Lista de fornecedores'} • ${new Date().toLocaleString('pt-BR')}`, pageWidth / 2, 59, { align: 'center' });
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 78,
      head: [['Resumo', 'Valor']],
      body: [
        ['Produtos', String(totals.count)],
        ['Custo do lote', money(totals.cost)],
        ['Mínimo viável', money(totals.revenue)],
        ['Mercado aprovado', money(totals.recommendedRevenue)],
        ['Lucro no mínimo viável', money(totals.profit)],
        ['Lucro no mercado aprovado', money(totals.marketProfit)],
        ['Inconclusivos', String(totals.inconclusive)],
      ],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
    });
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 16,
      head: [['Produto', 'Custo', 'Mercado', 'Mínimo viável', 'Mercado aprovado', 'Lucro mín.', 'Marg. mín.', 'Lucro mercado', 'Marg. mercado', 'Decisão', 'Evid.']],
      body: results.map(item => [
        item.name,
        money(item.supplierCost),
        item.marketMedian ? money(item.marketMedian) : 'Sem evidência',
        money(item.pricing?.minimumPrice),
        item.pricing?.marketRecommendedPrice ? money(item.pricing.marketRecommendedPrice) : 'Não aprovado',
        money(item.pricing?.netProfit),
        `${(item.pricing?.marginPercent || 0).toFixed(2)}%`,
        approvedMoney(item.pricing?.marketNetProfit),
        approvedPercent(item.pricing?.marketMarginPercent),
        item.pricing ? decisionLabel[item.pricing.decision] : 'Inconclusivo',
        String(item.evidenceCount),
      ]),
      styles: { fontSize: 7, cellPadding: 4 },
      headStyles: { fillColor: [79, 70, 229] },
      columnStyles: { 0: { cellWidth: 105 }, 7: { cellWidth: 65 } },
    });
    let cursorY = (doc as any).lastAutoTable.finalY + 16;
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text('Fontes consultadas:', 40, cursorY);
    cursorY += 12;
    const sources = results.flatMap(item => item.sources.map(source => `${sourceStatusLabel(source.status)} — ${item.name}: ${source.price == null ? 'sem preço' : money(source.price)} — ${source.url || 'sem link'} — ${source.rejection_reason || source.acceptance_reason || 'sem justificativa'}`));
    const sourceLines = sources.length ? sources : ['Nenhuma evidência pública retornada nesta análise.'];
    sourceLines.forEach(source => {
      const wrapped = doc.splitTextToSize(source, pageWidth - 80);
      if (cursorY + wrapped.length * 10 > doc.internal.pageSize.getHeight() - 35) { doc.addPage(); cursorY = 42; }
      doc.text(wrapped, 40, cursorY);
      cursorY += wrapped.length * 10 + 3;
    });
    doc.save('precificador-mercado.pdf');
  };

  return (
    <div className="space-y-5">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Radar className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Precificador de Mercado</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Cole uma lista de fornecedores ou importe TXT/CSV. “Grade A” é uma classificação interna do fornecedor e é ignorada. Só entram como comparáveis anúncios que confirmem novo/lacrado, modelo, capacidade e cor informada; preço de mercado só é aprovado com pelo menos {MINIMUM_COMPARABLE_EVIDENCE} evidências consistentes. O sistema mantém separados o preço mínimo viável e o cenário de mercado.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={subTab} onValueChange={value => setSubTab(value as typeof subTab)}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="analysis" className="gap-1 text-xs sm:text-sm"><Search className="h-3.5 w-3.5" /> Analisar</TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1 text-xs sm:text-sm"><Settings2 className="h-3.5 w-3.5" /> Gastos</TabsTrigger>
          <TabsTrigger value="history" className="gap-1 text-xs sm:text-sm"><History className="h-3.5 w-3.5" /> Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-primary" /> 1. Lista de fornecedores</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>Nome da análise</Label><Input value={inputName} onChange={event => setInputName(event.target.value)} placeholder="Ex.: listas de outubro" /></div>
                <div className="space-y-1"><Label>Lucro líquido mínimo por item</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">R$</span><Input className="pl-9" inputMode="decimal" value={minimumProfit} onChange={event => setMinimumProfit(event.target.value)} /></div></div>
              </div>
              <textarea value={inputText} onChange={event => setInputText(event.target.value)} placeholder={'Cole aqui as listas dos fornecedores, uma linha por produto. Ex.:\niPhone 15 128GB — R$ 2.950,00\nMoto G55 256GB — R$ 1.400,00'} className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"><Upload className="h-4 w-4" /> Importar TXT/CSV/TSV<input type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" className="hidden" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { setInputText(await fileToText(file)); setInputName(file.name); toast.success('Arquivo carregado.'); } catch (error: any) { toast.error(error?.message || 'Falha ao ler o arquivo.'); } event.currentTarget.value = ''; }} /></label>
                <span className="text-xs text-muted-foreground">{parsedItems.length} produtos identificados · até 53 serão pesquisados</span>
              </div>
            </CardContent>
          </Card>

          {candidateItems.length > 0 && <Card>
            <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-primary" /> 2. Revise os produtos recorrentes</CardTitle><span className="text-xs text-muted-foreground">{selectedItems.length}/53 selecionados</span></div></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">A ordem considera quantas vezes o produto apareceu nas listas. O custo vem da lista ou do cadastro existente; produtos sem custo ficam bloqueados até você corrigir a origem.</p>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{candidateItems.map(item => {
                const selected = selectedKeys.includes(item.key);
                return <label key={item.key} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${selected ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
                  <input type="checkbox" checked={selected} disabled={!selected && selectedItems.length >= 53} onChange={() => setSelectedKeys(previous => selected ? previous.filter(key => key !== item.key) : [...previous, item.key].slice(0, 53))} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{item.name}</span><span className="text-[11px] text-muted-foreground">{item.occurrences} ocorrência(s) · custo {item.supplierCost ? money(item.supplierCost) : 'não encontrado'}</span></span>
                  {item.costWarning ? <Badge variant="destructive">Revisar custo</Badge> : item.supplierCost ? <Badge variant="secondary">Pronto</Badge> : <Badge variant="destructive">Sem custo</Badge>}
                </label>;
              })}</div>
            </CardContent>
          </Card>}

          <div className="flex flex-wrap gap-2"><Button onClick={analyze} disabled={researching || !selectedItems.length}>{researching ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pesquisando fontes...</> : <><Search className="mr-2 h-4 w-4" /> Pesquisar mercado e calcular</>}</Button>{results.length > 0 && <><Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" /> Exportar CSV</Button><Button variant="outline" onClick={exportText}><FileText className="mr-2 h-4 w-4" /> Exportar TXT</Button><Button variant="outline" onClick={exportPdf}><FileDown className="mr-2 h-4 w-4" /> Exportar PDF</Button><Button variant="outline" onClick={() => void copyText()}><Clipboard className="mr-2 h-4 w-4" /> Copiar resultado</Button></>}</div>

          {results.length > 0 && <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-9"><Metric title="Produtos" value={String(totals.count)} /><Metric title="Custo do lote" value={money(totals.cost)} /><Metric title="Mínimo viável" value={money(totals.revenue)} /><Metric title="Mercado aprovado" value={money(totals.recommendedRevenue)} /><Metric title="Lucro mínimo" value={money(totals.profit)} tone="text-green-500" /><Metric title="Lucro no mercado" value={money(totals.marketProfit)} tone="text-green-500" /><Metric title="Carro-chefe" value={String(totals.stars)} tone="text-primary" /><Metric title="Margem segura" value={String(totals.safe)} tone="text-amber-500" /><Metric title="Inconclusivos" value={String(totals.inconclusive)} tone="text-destructive" /></div>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Resultado auditável por produto</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1250px] text-xs">
                    <thead className="bg-muted/50"><tr><th className="p-3 text-left">Produto</th><th className="p-3 text-right">Custo</th><th className="p-3 text-right">Mercado</th><th className="p-3 text-right">Mínimo viável</th><th className="p-3 text-right">Mercado aprovado</th><th className="p-3 text-right">Gastos</th><th className="p-3 text-right">Lucro mín.</th><th className="p-3 text-right">Marg. mín.</th><th className="p-3 text-right">Lucro mercado</th><th className="p-3 text-right">Marg. mercado</th><th className="p-3 text-left">Decisão</th><th className="p-3 text-left">Evidências e justificativas</th></tr></thead>
                    <tbody>{results.map(item => {
                      const comparableSources = item.sources.filter(source => source.status === 'comparable');
                      const indicativeSources = item.sources.filter(source => source.status === 'indicative');
                      const rejectedSources = item.sources.filter(source => source.status === 'rejected');
                      return <tr key={item.key} className="border-t align-top">
                        <td className="p-3"><div className="font-medium text-foreground">{item.name}</div><div className="text-muted-foreground">{item.occurrences} ocorrência(s) · {item.foundCount} encontrados · {item.evidenceCount}/{MINIMUM_COMPARABLE_EVIDENCE} aprovados · {item.indicativeCount} indicativos · {item.rejectedCount} rejeitados</div><div className="mt-1 max-w-[240px] text-[10px] text-muted-foreground">{item.qualityNote}</div></td>
                        <td className="p-3 text-right font-medium">{money(item.supplierCost)}</td>
                        <td className="p-3 text-right">{item.marketMedian != null ? <><div>{money(item.marketMedian)}</div><div className="text-[10px] text-muted-foreground">{money(item.marketMin)} – {money(item.marketMax)}</div>{item.qualityStatus !== 'approved' && <div className="text-[10px] font-medium text-amber-500">Mediana indicativa</div>}</> : <span className="text-destructive">Sem evidência</span>}</td>
                        <td className="p-3 text-right font-semibold">{money(item.pricing?.minimumPrice)}</td>
                        <td className="p-3 text-right font-semibold">{item.pricing?.marketRecommendedPrice != null ? money(item.pricing.marketRecommendedPrice) : <span className="text-destructive">Não aprovado</span>}</td>
                        <td className="p-3 text-right text-red-400">{money((item.pricing?.fixedExpenses || 0) + ((item.pricing?.minimumPrice || 0) * (item.pricing?.percentageExpenses || 0) / 100))}</td>
                        <td className="p-3 text-right font-semibold text-green-500">{money(item.pricing?.netProfit)}</td>
                        <td className="p-3 text-right font-semibold">{(item.pricing?.marginPercent || 0).toFixed(2)}%</td>
                        <td className="p-3 text-right font-semibold text-green-500">{approvedMoney(item.pricing?.marketNetProfit)}</td>
                        <td className="p-3 text-right font-semibold">{approvedPercent(item.pricing?.marketMarginPercent)}</td>
                        <td className="p-3"><div className="space-y-1"><span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${decisionClass[item.pricing?.decision || 'inconclusivo']}`}>{decisionLabel[item.pricing?.decision || 'inconclusivo']}</span><br /><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-medium ${qualityClass[item.qualityStatus]}`}>{qualityLabel[item.qualityStatus]}</span></div></td>
                        <td className="p-3"><div className="max-w-[280px] space-y-2">
                          {comparableSources.slice(0, 5).map(source => <a key={`${source.url}-${source.price}`} href={source.url || '#'} target="_blank" rel="noreferrer" title={source.acceptance_reason || ''} className="flex items-start gap-1 text-primary hover:underline"><ExternalLink className="mt-0.5 h-3 w-3 shrink-0" /><span>{source.price == null ? 'Sem preço' : money(source.price)} · {source.title}</span></a>)}
                          {comparableSources.length > 5 && <details className="rounded border border-border p-2"><summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Ver mais {comparableSources.length - 5} fontes comparáveis</summary><div className="mt-2 space-y-2">{comparableSources.slice(5).map(source => <a key={`${source.url}-${source.price}`} href={source.url || '#'} target="_blank" rel="noreferrer" title={source.acceptance_reason || ''} className="flex items-start gap-1 border-t pt-2 text-primary hover:underline"><ExternalLink className="mt-0.5 h-3 w-3 shrink-0" /><span>{source.price == null ? 'Sem preço' : money(source.price)} · {source.title}</span></a>)}</div></details>}
                          {indicativeSources.length > 0 && <details className="rounded border border-amber-500/30 bg-amber-500/5 p-2"><summary className="cursor-pointer text-[11px] font-medium text-amber-600">Ver {indicativeSources.length} evidências indicativas</summary><div className="mt-2 space-y-2">{indicativeSources.map((source, index) => <div key={`${source.url}-${source.price}-${index}`} className="border-t pt-2"><div className="font-medium text-foreground">{source.title}</div><div>{source.price == null ? 'Sem preço válido' : money(source.price)}{source.url && <> · <a href={source.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">abrir anúncio</a></>}</div><div className="text-[10px] text-amber-600">Motivo: {source.rejection_reason || 'Falta confirmar um atributo.'}</div></div>)}</div></details>}
                          {rejectedSources.length > 0 && <details className="rounded border border-border p-2"><summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Ver {rejectedSources.length} anúncios rejeitados</summary><div className="mt-2 space-y-2">{rejectedSources.map((source, index) => <div key={`${source.url}-${source.price}-${index}`} className="border-t pt-2"><div className="font-medium text-foreground">{source.title}</div><div>{source.price == null ? 'Sem preço válido' : money(source.price)}{source.url && <> · <a href={source.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">abrir anúncio</a></>}</div><div className="text-[10px] text-destructive">Motivo: {source.rejection_reason || 'Não passou na validação.'}</div></div>)}</div></details>}
                          {item.sources.length === 0 && <span className="text-destructive">Nenhum anúncio retornado</span>}
                        </div></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />O sistema faz até três rodadas de busca quando a primeira fonte não alcança {MINIMUM_COMPARABLE_EVIDENCE} evidências aprovadas. Evidências indicativas (loja encontrada, mas memória ou condição não confirmada no título) ficam visíveis e não aprovam o preço sozinhas. Usados, Grade A, variantes incompatíveis e preços atípicos continuam rejeitados.</div>
          </>}
        </TabsContent>

        <TabsContent value="expenses" className="mt-4 space-y-4">
          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-4 w-4 text-primary" /> Gastos usados pelo Precificador</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted-foreground">Esses gastos entram no cálculo das próximas análises. Você pode cadastrar nomes diferentes por empresa, ativar ou desativar cada um e criar exceções por produto.</p><div className="grid gap-3 sm:grid-cols-[1fr_150px_130px_1fr_auto]"><Input value={expenseForm.label} onChange={event => setExpenseForm({ ...expenseForm, label: event.target.value })} placeholder="Ex.: Motoboy" /><select value={expenseForm.amountType} onChange={event => setExpenseForm({ ...expenseForm, amountType: event.target.value as 'percentage' | 'fixed' })} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="percentage">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select><Input value={expenseForm.amount} onChange={event => setExpenseForm({ ...expenseForm, amount: event.target.value })} placeholder={expenseForm.amountType === 'percentage' ? '4,99' : '50,00'} inputMode="decimal" /><select value={expenseForm.productId} onChange={event => setExpenseForm({ ...expenseForm, productId: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">Gasto geral</option>{(catalogQuery.data || []).map(product => <option key={product.id} value={product.id}>Só: {product.name}</option>)}</select><Button onClick={addExpense} disabled={savingExpense}><Plus className="mr-1 h-4 w-4" /> Adicionar</Button></div><div className="space-y-2">{(expensesQuery.data || []).map(expense => <div key={expense.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><button type="button" onClick={() => toggleExpense(expense)} className={`h-5 w-5 rounded border ${expense.enabled ? 'border-primary bg-primary' : 'border-muted-foreground'}`} aria-label={expense.enabled ? 'Desativar gasto' : 'Ativar gasto'}>{expense.enabled && <CheckCircle2 className="h-4 w-4 text-primary-foreground" />}</button><div className="min-w-0 flex-1"><p className={`text-sm font-medium ${expense.enabled ? 'text-foreground' : 'text-muted-foreground line-through'}`}>{expense.label}</p><p className="text-[11px] text-muted-foreground">{expense.amount_type === 'percentage' ? `${Number(expense.amount).toFixed(2).replace('.', ',')}% sobre o preço` : `${money(Number(expense.amount))} por item/operação`}{expense.product_id ? ' · exceção de produto' : ' · geral'}</p></div><button type="button" onClick={() => removeExpense(expense)} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remover gasto"><Trash2 className="h-4 w-4" /></button></div>)}</div></CardContent></Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-3">{historyQuery.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando histórico...</p> : !historyQuery.data?.length ? <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Nenhuma análise salva ainda.</CardContent></Card> : historyQuery.data.map(history => <Card key={history.id}><CardContent className="flex flex-wrap items-center gap-4 p-4"><History className="h-5 w-5 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium text-foreground">{history.input_name || 'Lista de fornecedores'}</p><p className="text-xs text-muted-foreground">{dateBR(history.created_at)} · lucro mínimo {money(history.minimum_profit)}</p></div><Badge variant={history.status === 'completed' ? 'default' : 'secondary'}>{history.status === 'completed' ? 'Concluída' : 'Parcial'}</Badge><span className="text-sm font-semibold">{money(history.totals?.market_profit ?? history.totals?.profit)} de lucro no mercado</span></CardContent></Card>)}</TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ title, value, tone = 'text-foreground' }: { title: string; value: string; tone?: string }) {
  return <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{title}</p><p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p></CardContent></Card>;
}
