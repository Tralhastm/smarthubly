import { useMemo, useState } from 'react';
import { Calculator, Download, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';

type Unit = 'brl' | 'percent';
type InputRow = { name: string; supplier: number; base: number; color: number | null; baseColor: number | null };
type ResultRow = InputRow & { suggested: number; profitBeforeSeller: number; seller: number; netProfit: number; netMargin: number; targetPrice: number; colorSuggested: number | null; colorNetProfit: number | null };

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numberBR = (value: string) => {
  const cleaned = value.replace(/R\$|\s/g, '').trim();
  if (!cleaned) return 0;
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
};
const priceToken = (value: string) => numberBR(value.replace(/[^\d.,-]/g, ''));
const parseRow = (line: string): InputRow | null => {
  const text = line.trim();
  if (!text || /^(produto|nome)\b/i.test(text)) return null;
  const parts = text.includes('|') ? text.split('|') : text.includes('\t') ? text.split('\t') : text.split(';');
  if (parts.length >= 3) {
    const values = parts.slice(1).map(priceToken);
    if (!values[0] && !values[1]) return null;
    return { name: parts[0].replace(/^\s*\d+[.)-]\s*/, '').trim(), supplier: values[0], base: values[1], color: values[2] || null, baseColor: values[3] || null };
  }
  const labeled = [...text.matchAll(/(?:fornecedor|custo|base\s*cor|pre[cç]o\s*cor|pre[cç]o\s*base|base)\s*[:=-]\s*(R?\$?\s*[\d.,]+)/giu)];
  if (labeled.length >= 2) {
    const first = text.search(/(?:fornecedor|custo)\s*[:=-]/i);
    const values = labeled.map(match => priceToken(match[1]));
    return { name: text.slice(0, first).replace(/^\s*\d+[.)-]\s*/, '').replace(/[|,-]\s*$/, '').trim(), supplier: values[0] || 0, base: values[1] || 0, color: values[2] || null, baseColor: values[3] || null };
  }
  const currencyValues = [...text.matchAll(/R?\$\s*([\d.]+(?:,\d{1,2})?)/g)].map(match => priceToken(match[1]));
  if (currencyValues.length >= 2) {
    const firstCurrency = text.search(/R?\$\s*[\d.]+(?:,\d{1,2})?/i);
    return { name: text.slice(0, firstCurrency).replace(/^\s*\d+[.)-]\s*/, '').replace(/[|,;:-]\s*$/, '').trim(), supplier: currencyValues[0], base: currencyValues[1], color: currencyValues[2] || null, baseColor: currencyValues[3] || null };
  }
  return null;
};

const expenseValue = (amount: number, unit: Unit, sale: number) => unit === 'percent' ? sale * amount / 100 : amount;

const FinancialCalculator = () => {
  const [text, setText] = useState('');
  const [asaas, setAsaas] = useState('4.6');
  const [asaasUnit, setAsaasUnit] = useState<Unit>('percent');
  const [freight, setFreight] = useState('20');
  const [freightUnit, setFreightUnit] = useState<Unit>('brl');
  const [discount, setDiscount] = useState('10');
  const [discountUnit, setDiscountUnit] = useState<Unit>('brl');
  const [other, setOther] = useState('0');
  const [otherUnit, setOtherUnit] = useState<Unit>('brl');
  const [sellerPercent, setSellerPercent] = useState('20');
  const [targetMargin, setTargetMargin] = useState('10');

  const rows = useMemo(() => text.split(/\r?\n/).map(parseRow).filter(Boolean) as InputRow[], [text]);
  const results = useMemo<ResultRow[]>(() => rows.map(row => {
    const suggested = Math.max(0, row.base - 20);
    const fixed = expenseValue(Number(freight) || 0, freightUnit, suggested) + expenseValue(Number(discount) || 0, discountUnit, suggested) + expenseValue(Number(other) || 0, otherUnit, suggested);
    const rate = asaasUnit === 'percent' ? (Number(asaas) || 0) / 100 : 0;
    const asaasValue = expenseValue(Number(asaas) || 0, asaasUnit, suggested);
    const before = suggested - row.supplier - asaasValue - fixed;
    const seller = Math.max(0, before) * ((Number(sellerPercent) || 0) / 100);
    const net = before - seller;
    const margin = suggested > 0 ? net / suggested * 100 : 0;
    const target = Number(targetMargin) || 0;
    const variableRate = rate + (freightUnit === 'percent' ? (Number(freight) || 0) / 100 : 0) + (discountUnit === 'percent' ? (Number(discount) || 0) / 100 : 0) + (otherUnit === 'percent' ? (Number(other) || 0) / 100 : 0);
    const fixedExpenses = (freightUnit === 'brl' ? Number(freight) || 0 : 0) + (discountUnit === 'brl' ? Number(discount) || 0 : 0) + (otherUnit === 'brl' ? Number(other) || 0 : 0);
    const denominator = (1 - variableRate) * (1 - (Number(sellerPercent) || 0) / 100) - target / 100;
    const targetPrice = denominator > 0 ? (row.supplier + fixedExpenses) / denominator : 0;
    const colorSuggested = row.baseColor ? Math.max(0, row.baseColor - 20) : row.color ? Math.max(0, row.color - 20) : null;
    const colorNet = colorSuggested == null ? null : colorSuggested - row.supplier - expenseValue(Number(asaas) || 0, asaasUnit, colorSuggested) - expenseValue(Number(freight) || 0, freightUnit, colorSuggested) - expenseValue(Number(discount) || 0, discountUnit, colorSuggested) - expenseValue(Number(other) || 0, otherUnit, colorSuggested);
    return { ...row, suggested, profitBeforeSeller: before, seller, netProfit: net, netMargin: margin, targetPrice, colorSuggested, colorNetProfit: colorNet };
  }), [rows, asaas, asaasUnit, freight, freightUnit, discount, discountUnit, other, otherUnit, sellerPercent, targetMargin]);

  const summary = useMemo(() => ({
    positive: results.filter(r => r.netProfit >= 0).length,
    negative: results.filter(r => r.netProfit < 0).length,
    net: results.reduce((sum, r) => sum + r.netProfit, 0),
  }), [results]);

  const exportCsv = () => {
    const header = 'Produto;Fornecedor;Preço base;Preço sugerido;Lucro antes vendedor;Comissão vendedor;Lucro líquido;Margem líquida;Preço para meta';
    const lines = results.map(r => [r.name, r.supplier, r.base, r.suggested, r.profitBeforeSeller, r.seller, r.netProfit, r.netMargin, r.targetPrice].map(v => typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v).join(';'));
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'calculadora-financeira.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const Field = ({ label, value, setValue, unit, setUnit }: { label: string; value: string; setValue: (v: string) => void; unit: Unit; setUnit: (v: Unit) => void }) => (
    <div className="rounded-lg border border-border bg-secondary/40 p-2 space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="flex gap-1"><input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" /><select value={unit} onChange={e => setUnit(e.target.value as Unit)} className="rounded-md border border-border bg-background px-1 text-xs"><option value="brl">R$</option><option value="percent">%</option></select></div>
    </div>
  );

  return <div className="space-y-4">
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Calculator className="h-5 w-5 text-primary" /> Calculadora de precificação</h2><p className="text-xs text-muted-foreground mt-1">Cole até centenas de produtos. Formato: Nome | Fornecedor | Preço base | Preço cor | Preço base cor.</p></div><label className="cursor-pointer rounded-lg border border-border bg-secondary px-3 py-2 text-xs"><Upload className="mr-1 inline h-3.5 w-3.5" /> Importar .txt<input type="file" accept=".txt,.csv" className="hidden" onChange={async e => { const file = e.target.files?.[0]; if (file) setText(await file.text()); e.currentTarget.value = ''; }} /></label></div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={8} placeholder={'Exemplo:\nRealme C100x | 1000 | 1259,90 | 1050 | 1309,90\nRedmi A7 | 710 | 829'} className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Field label="Taxa Asaas/checkout" value={asaas} setValue={setAsaas} unit={asaasUnit} setUnit={setAsaasUnit} /><Field label="Frete" value={freight} setValue={setFreight} unit={freightUnit} setUnit={setFreightUnit} /><Field label="Desconto cliente" value={discount} setValue={setDiscount} unit={discountUnit} setUnit={setDiscountUnit} /><Field label="Outros gastos" value={other} setValue={setOther} unit={otherUnit} setUnit={setOtherUnit} /></div>
      <div className="grid grid-cols-2 gap-2"><label className="rounded-lg border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">Comissão vendedor sobre lucro (%)<input value={sellerPercent} onChange={e => setSellerPercent(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" /></label><label className="rounded-lg border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">Margem líquida desejada (%)<input value={targetMargin} onChange={e => setTargetMargin(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" /></label></div>
      <p className="text-xs text-muted-foreground">Preço sugerido automático = preço base − R$ 20. O vendedor recebe somente a porcentagem configurada sobre o lucro positivo. A coluna “Preço para meta” mostra quanto cobrar para atingir a margem líquida desejada.</p>
    </div>
    {results.length > 0 && <>
      <div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-secondary p-3"><div className="text-xs text-muted-foreground">Produtos</div><strong>{results.length}</strong></div><div className="rounded-lg bg-green-500/10 p-3"><div className="text-xs text-muted-foreground">Positivos</div><strong className="text-green-400">{summary.positive}</strong></div><div className="rounded-lg bg-primary/10 p-3"><div className="text-xs text-muted-foreground">Lucro líquido total</div><strong className={summary.net >= 0 ? 'text-green-400' : 'text-red-400'}>{money(summary.net)}</strong></div></div>
      <div className="flex justify-end"><button onClick={exportCsv} className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs"><Download className="mr-1 inline h-3.5 w-3.5" /> Exportar CSV</button></div>
      <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[1050px] text-xs"><thead className="bg-secondary"><tr>{['Produto','Fornecedor','Base','Sugerido','Lucro antes','Vendedor','Lucro líquido','Margem','Preço para meta','Cor sugerida'].map(h => <th key={h} className="whitespace-nowrap p-2 text-left">{h}</th>)}</tr></thead><tbody>{results.map((r, i) => <tr key={`${r.name}-${i}`} className="border-t border-border"><td className="max-w-[220px] p-2 font-medium">{r.name}</td><td className="p-2">{money(r.supplier)}</td><td className="p-2">{money(r.base)}</td><td className="p-2">{money(r.suggested)}</td><td className={`p-2 ${r.profitBeforeSeller < 0 ? 'text-red-400' : ''}`}>{money(r.profitBeforeSeller)}</td><td className="p-2">{money(r.seller)}</td><td className={`p-2 font-semibold ${r.netProfit < 0 ? 'text-red-400' : 'text-green-400'}`}>{money(r.netProfit)}</td><td className="p-2">{r.netMargin.toFixed(1)}%</td><td className="p-2">{money(r.targetPrice)}</td><td className="p-2">{r.colorSuggested == null ? '—' : money(r.colorSuggested)}{r.colorNetProfit != null && <span className={`ml-1 ${r.colorNetProfit < 0 ? 'text-red-400' : 'text-green-400'}`}>({money(r.colorNetProfit)})</span>}</td></tr>)}</tbody></table></div>
      {summary.negative > 0 ? <p className="flex items-center gap-2 text-xs text-yellow-400"><AlertTriangle className="h-4 w-4" /> {summary.negative} produto(s) ficam negativos com estas despesas.</p> : <p className="flex items-center gap-2 text-xs text-green-400"><CheckCircle2 className="h-4 w-4" /> Todos os produtos ficam positivos.</p>}
    </>}
  </div>;
};

export default FinancialCalculator;
