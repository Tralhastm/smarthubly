export type SofiaKnowledgeEntry = {
  title?: unknown;
  domain?: unknown;
  content?: unknown;
  active?: unknown;
  status?: unknown;
  validation_status?: unknown;
  sharing_scope?: unknown;
};

export type SofiaCaseEntry = {
  situation?: unknown;
  problem?: unknown;
  diagnosis?: unknown;
  action_taken?: unknown;
  result?: unknown;
  status?: unknown;
};

export const SOFIA_FEEDBACK_CATEGORIES = ['incorrect', 'incomplete', 'current_data', 'navigation', 'other'] as const;

export function isSofiaFeedbackCategory(value: unknown): value is typeof SOFIA_FEEDBACK_CATEGORIES[number] {
  return typeof value === 'string' && SOFIA_FEEDBACK_CATEGORIES.includes(value as typeof SOFIA_FEEDBACK_CATEGORIES[number]);
}

const COMMON_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em',
  'essa', 'esse', 'esta', 'este', 'eu', 'favor', 'me', 'meu', 'minha', 'na', 'nas',
  'no', 'nos', 'o', 'os', 'para', 'por', 'qual', 'quais', 'que', 'se', 'sobre', 'um',
  'uma', 'umas', 'uns', 'voce', 'voces', 'sao', 'aqui', 'agora', 'hoje', 'atual', 'atuais',
]);

const PRODUCT_QUERY_WORDS = new Set([
  'preco', 'precos', 'valor', 'valores', 'custa', 'custam', 'quanto', 'produto', 'produtos',
  'catalogo', 'cardapio', 'estoque', 'disponivel', 'disponibilidade', 'tem', 'vender', 'venda', 'lista',
  'listar', 'meus', 'minhas', 'atual', 'atuais', 'hoje', 'quanto', 'qual', 'quais', 'produto', 'produtos',
  'tabela', 'todo', 'todos', 'todas', 'completo', 'completa', 'mostrar', 'mostre', 'exibir', 'exiba', 'ver', 'vitrine', 'preco', 'precos',
]);

export function normalizeSofiaText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getSofiaLookupTerms(question: string): string[] {
  return [...new Set(normalizeSofiaText(question)
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !COMMON_WORDS.has(word)))].slice(0, 8);
}

export function getSofiaProductSearchTerms(question: string): string[] {
  const originalWords = String(question ?? '').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set<string>();
  return originalWords.filter((word) => {
    const normalized = normalizeSofiaText(word);
    if (normalized.length < 2 || COMMON_WORDS.has(normalized) || PRODUCT_QUERY_WORDS.has(normalized) || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 5);
}

export function isSofiaInStock(value: unknown): boolean {
  return value !== false && String(value).toLowerCase() !== 'false';
}

export function scoreSofiaProductMatch(product: Record<string, unknown>, terms: string[]): number {
  if (!terms.length) return 0;
  const searchable = normalizeSofiaText(`${product.name ?? ''} ${product.description ?? ''} ${product.category ?? ''} ${product.subcategory ?? ''}`);
  return terms.reduce((score, term) => score + (searchable.includes(normalizeSofiaText(term)) ? 1 : 0), 0);
}

export function shouldLookupSofiaProducts(question: string): boolean {
  const normalized = normalizeSofiaText(question);
  const asksAboutProducts = /\b(preco|precos|valor|valores|custa|custam|quanto|produto|produtos|catalogo|estoque|disponivel|disponibilidade|tem)\b/.test(normalized);
  const asksForCatalog = /\b(lista|listar|catalogo|todos os produtos|tabela de precos|todos os precos)\b/.test(normalized);
  return asksForCatalog || (asksAboutProducts && getSofiaProductSearchTerms(question).length > 0);
}

export function shouldLookupSofiaOrders(question: string): boolean {
  if (extractSofiaOrderReference(question)) return true;
  const normalized = normalizeSofiaText(question);
  return /\b(pedido|pedidos)\b/.test(normalized)
    && /\b(status|pagamento|pago|entrega|retirada|preparando|cancelado|cancelar|entregue|meu|minha|meus|ultimos|recentes|listar|lista|mostrar|mostre|quais|qual)\b/.test(normalized);
}

export function shouldListRecentSofiaOrders(question: string): boolean {
  const normalized = normalizeSofiaText(question);
  return /\b(pedido|pedidos)\b/.test(normalized)
    && /\b(ultimos|recentes|listar|lista|mostrar|mostre|quais)\b/.test(normalized);
}

export function shouldLookupSofiaCases(question: string): boolean {
  return /\b(erro|problema|falha|travou|bug|nao funciona|nao consigo|resolver|corrigir|diagnostico|diagnosticar|deu ruim)\b/.test(normalizeSofiaText(question));
}

function relevanceScore(record: Record<string, unknown>, question: string, fields: string[]): number {
  const terms = getSofiaLookupTerms(question);
  if (terms.length === 0) return 0;
  const searchable = normalizeSofiaText(fields.map((field) => record[field] ?? '').join(' '));
  return terms.reduce((score, term) => score + (searchable.includes(term) ? Math.min(term.length, 8) : 0), 0);
}

export function selectRelevantSofiaKnowledge<T extends SofiaKnowledgeEntry>(
  entries: T[],
  question: string,
  limit = 5,
): T[] {
  const approved = entries.filter((entry) => entry.active === true
    && entry.status === 'approved'
    && entry.validation_status === 'validated'
    && entry.sharing_scope === 'platform');
  return approved
    .map((entry) => ({ entry, score: relevanceScore(entry as Record<string, unknown>, question, ['title', 'domain', 'content']) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map(({ entry }) => entry);
}

export function selectRelevantSofiaCases<T extends SofiaCaseEntry>(
  cases: T[],
  question: string,
  limit = 3,
): T[] {
  return cases
    .filter((item) => item.status === 'resolved' || item.status === 'validated')
    .map((item) => ({ item, score: relevanceScore(item as Record<string, unknown>, question, ['situation', 'problem', 'diagnosis', 'action_taken', 'result']) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item);
}

export function extractSofiaOrderReference(question: string): { value: string; isFullUuid: boolean } | null {
  const match = question.match(/\bpedido\s*(?:n(?:umero)?[ºo.]?\s*)?#?\s*([0-9a-f-]{6,36})\b/i);
  if (!match) return null;
  const value = match[1].replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{6,32}$/.test(value)) return null;
  return { value, isFullUuid: value.length === 32 };
}

function asUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function getSofiaOrderPrefixBounds(prefix: string): { low: string; high: string } | null {
  const clean = prefix.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length < 6 || clean.length > 32) return null;
  const lowHex = (clean + '0'.repeat(32)).slice(0, 32);
  const highHex = (clean + 'f'.repeat(32)).slice(0, 32);
  return { low: asUuid(lowHex), high: asUuid(highHex) };
}

export type SofiaOrderLookupPlan =
  | { kind: 'exact'; tenantId: string; orderId: string; reference: string | null }
  | { kind: 'prefix'; tenantId: string; low: string; high: string; reference: string }
  | { kind: 'recent'; tenantId: string }
  | null;

function normalizeOrderUuid(value: unknown): string | null {
  const hex = String(value ?? '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return asUuid(hex);
}

export function planSofiaOrderLookup(input: {
  scopeSource: string | null;
  tenantId: string | null;
  linkedOrderId?: string | null;
  requestedOrderId?: string | null;
  question: string;
}): SofiaOrderLookupPlan {
  if (!input.tenantId || input.scopeSource !== 'authenticated') return null;
  const linked = normalizeOrderUuid(input.linkedOrderId);
  if (linked) return { kind: 'exact', tenantId: input.tenantId, orderId: linked, reference: null };
  const requested = normalizeOrderUuid(input.requestedOrderId);
  if (requested) return { kind: 'exact', tenantId: input.tenantId, orderId: requested, reference: null };
  if (!shouldLookupSofiaOrders(input.question)) return null;
  const reference = extractSofiaOrderReference(input.question);
  if (reference) {
    const bounds = getSofiaOrderPrefixBounds(reference.value);
    if (!bounds) return null;
    if (reference.isFullUuid) return { kind: 'exact', tenantId: input.tenantId, orderId: bounds.low, reference: reference.value };
    return { kind: 'prefix', tenantId: input.tenantId, ...bounds, reference: reference.value };
  }
  return shouldListRecentSofiaOrders(input.question) ? { kind: 'recent', tenantId: input.tenantId } : null;
}

export function calculateSofiaVariantSalePrice(productPrice: unknown, priceDelta: unknown): number {
  const base = Number(productPrice) || 0;
  const delta = Number(priceDelta) || 0;
  return Math.max(0, base + delta);
}

export function getSofiaLowestInStockVariantPrice(
  productPrice: unknown,
  variants: Array<{ in_stock?: unknown; price_delta?: unknown }>,
): number | null {
  const prices = variants.filter((variant) => isSofiaInStock(variant.in_stock))
    .map((variant) => calculateSofiaVariantSalePrice(productPrice, variant.price_delta))
    .filter((price) => price > 0);
  return prices.length ? Math.min(...prices) : null;
}

export function redactSofiaText(value: unknown, maxLength = 1000): string {
  return String(value ?? '')
    .slice(0, maxLength)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removido]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id removido]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento removido]')
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-.\s]?\d{4}\b/g, '[telefone removido]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})\b/g, '[segredo removido]');
}
