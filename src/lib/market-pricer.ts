export type ParsedSupplierItem = {
  key: string;
  name: string;
  supplierCost: number | null;
  costWarning: string | null;
  occurrences: number;
  sourceLines: string[];
};

export type PricerExpense = {
  id?: string;
  label: string;
  amountType: 'percentage' | 'fixed';
  amount: number;
  enabled: boolean;
  productId?: string | null;
};

export type PricerDecision = 'carro-chefe' | 'margem-segura' | 'inconclusivo';

export type PricingMath = {
  fixedExpenses: number;
  percentageExpenses: number;
  minimumPrice: number;
  marketRecommendedPrice: number | null;
  suggestedPrice: number;
  netProfit: number;
  marginPercent: number;
  marketNetProfit: number | null;
  marketMarginPercent: number | null;
};

const moneyValue = '[0-9]{1,3}(?:[.][0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?';
const ignoreLine = /^(?:data|lista|fornecedor|produto|pre[cç]o|valor|cat[aá]logo|dia|total|obs|observa)/i;

export function normalizeProductName(value: string): string {
  return value.replace(/\bgrade\s*[a-z]\b/gi, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').replace(/[|;]+$/g, '').trim();
}

export function parseBrazilianNumber(value: string): number {
  const trimmed = value.trim().replace(/\s/g, '');
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(trimmed)
      ? trimmed.replace(/\./g, '')
      : trimmed.replace(/,(?=\d{1,2}$)/, '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function extractCost(line: string): { value: number; start: number } | null {
  const currency = line.match(new RegExp(`R\\$\\s*(${moneyValue})`, 'i'));
  if (currency && currency.index != null) return { value: parseBrazilianNumber(currency[1]), start: currency.index };
  const parts = [...line.matchAll(new RegExp(`(?:^|[\\t;|]|\\s[-–—]\\s)(${moneyValue})\\s*$`, 'ig'))];
  const last = parts.at(-1);
  if (!last || last.index == null) return null;
  return { value: parseBrazilianNumber(last[1]), start: last.index + last[0].lastIndexOf(last[1]) };
}

function costWarning(value: number | null): string | null {
  return value != null && value > 0 && value < 10
    ? 'Custo suspeito: valor abaixo de R$ 10. Confirme se o separador de milhar foi lido corretamente.'
    : null;
}

function cleanName(raw: string, cost: { value: number; start: number } | null): string {
  const beforeCost = cost && cost.start >= 0 ? raw.slice(0, cost.start) : raw;
  return beforeCost.replace(/\bgrade\s*[a-z]\b/gi, ' ').replace(/^\s*(?:[-*•]+|\d+[.)-])\s*/, '').replace(/[|;,:–—-]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

export function parseSupplierText(text: string): ParsedSupplierItem[] {
  const grouped = new Map<string, ParsedSupplierItem>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || ignoreLine.test(line)) continue;
    const cost = extractCost(line);
    const name = cleanName(line, cost);
    if (name.length < 3 || /^(?:r\$|\$|[-–—])$/i.test(name)) continue;
    const key = normalizeProductName(name);
    if (!key || key.length < 3) continue;
    const previous = grouped.get(key);
    if (previous) {
      previous.occurrences += 1;
      if (previous.supplierCost == null && cost) {
        previous.supplierCost = cost.value;
        previous.costWarning = costWarning(cost.value);
      }
      previous.sourceLines.push(line);
    } else {
      grouped.set(key, { key, name, supplierCost: cost?.value ?? null, costWarning: costWarning(cost?.value ?? null), occurrences: 1, sourceLines: [line] });
    }
  }
  return [...grouped.values()].sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name));
}

export function roundMoney(value: number): number { return Math.round((Number(value) || 0) * 100) / 100; }

export function calculatePricing(
  supplierCost: number,
  expenses: PricerExpense[],
  marketMedian: number | null,
  minimumProfit: number,
  productId?: string | null,
  evidenceCount?: number,
): PricingMath & { decision: PricerDecision } {
  const applicable = expenses.filter(expense => expense.enabled && (!expense.productId || expense.productId === 'general' || expense.productId === productId));
  const fixedExpenses = applicable.filter(expense => expense.amountType === 'fixed').reduce((sum, expense) => sum + Math.max(0, Number(expense.amount) || 0), 0);
  const percentageExpenses = applicable.filter(expense => expense.amountType === 'percentage').reduce((sum, expense) => sum + Math.max(0, Number(expense.amount) || 0), 0);
  const divisor = Math.max(0.0001, 1 - percentageExpenses / 100);
  const minimumPrice = roundMoney((supplierCost + fixedExpenses + Math.max(0, minimumProfit)) / divisor);
  const hasMarket = Number.isFinite(marketMedian) && (marketMedian || 0) > 0 && (evidenceCount === undefined || evidenceCount >= 2);
  const marketCompatible = hasMarket && minimumPrice <= (marketMedian as number);
  const marketRoomPercent = marketCompatible ? (((marketMedian as number) - minimumPrice) / minimumPrice) * 100 : 0;
  const decision: PricerDecision = !marketCompatible ? 'inconclusivo' : marketRoomPercent >= 20 ? 'carro-chefe' : 'margem-segura';
  const marketRecommendedPrice = marketCompatible ? roundMoney(marketMedian as number) : null;
  const suggestedPrice = minimumPrice;
  const profitAt = (price: number) => {
    const percentageCost = price * percentageExpenses / 100;
    const netProfit = roundMoney(price - supplierCost - fixedExpenses - percentageCost);
    return { netProfit, marginPercent: price > 0 ? roundMoney((netProfit / price) * 100) : 0 };
  };
  const minimumMetrics = profitAt(suggestedPrice);
  const marketMetrics = marketRecommendedPrice == null ? null : profitAt(marketRecommendedPrice);
  return {
    fixedExpenses: roundMoney(fixedExpenses),
    percentageExpenses: roundMoney(percentageExpenses),
    minimumPrice,
    marketRecommendedPrice,
    suggestedPrice,
    netProfit: minimumMetrics.netProfit,
    marginPercent: minimumMetrics.marginPercent,
    marketNetProfit: marketMetrics?.netProfit ?? null,
    marketMarginPercent: marketMetrics?.marginPercent ?? null,
    decision,
  };
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [columns.map(escape).join(';'), ...rows.map(row => columns.map(column => escape(row[column])).join(';'))].join('\n');
}
