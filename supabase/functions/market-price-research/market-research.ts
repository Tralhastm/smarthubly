export const MINIMUM_COMPARABLE_EVIDENCE = 5;

export type EvidenceStatus = "comparable" | "rejected";
export type MarketQualityStatus = "approved" | "insufficient_evidence" | "suspect";
export type MarketEvidence = {
  source: "serpapi";
  title: string;
  price: number | null;
  url: string | null;
  condition: "new" | "unverified";
  collected_at: string;
  status: EvidenceStatus;
  acceptance_reason: string | null;
  rejection_reason: string | null;
};
export type MarketResearchSummary = {
  sources: MarketEvidence[];
  min: number | null;
  median: number | null;
  max: number | null;
  evidence_count: number;
  found_count: number;
  rejected_count: number;
  quality_status: MarketQualityStatus;
  quality_note: string;
};

type ShoppingResult = Record<string, unknown>;

const STOP_WORDS = new Set([
  "gb", "tb", "ram", "rom", "novo", "novos", "lacrado", "lacrados", "selado", "selados",
  "sealed", "brand", "new", "na", "no", "da", "de", "do", "das", "dos", "caixa",
  "original", "smartphone", "celular", "telefone", "para", "com", "versao", "virtual",
]);
const VARIANT_WORDS = new Set([
  "pro", "proplus", "max", "plus", "ultra", "mini", "air", "se", "fe", "lite", "neo",
  "fold", "flip", "note", "play", "power", "edge", "stylus", "active", "classic", "zoom",
]);
const BRAND_ALIASES = [new Set(["xiaomi", "redmi"]), new Set(["motorola", "moto"])];
const COLOR_GROUPS: Array<{ id: string; aliases: string[] }> = [
  { id: "black", aliases: ["preto", "preta", "negro", "negra", "black"] },
  { id: "white", aliases: ["branco", "branca", "white"] },
  { id: "gray", aliases: ["cinza", "cinzento", "cinzenta", "gray", "grey"] },
  { id: "blue", aliases: ["azul", "blue"] },
  { id: "green", aliases: ["verde", "green"] },
  { id: "red", aliases: ["vermelho", "vermelha", "red"] },
  { id: "gold", aliases: ["dourado", "dourada", "gold"] },
  { id: "silver", aliases: ["prata", "prateado", "prateada", "silver"] },
  { id: "purple", aliases: ["roxo", "roxa", "lilas", "lilac", "purple", "violet"] },
  { id: "pink", aliases: ["rosa", "pink"] },
  { id: "yellow", aliases: ["amarelo", "amarela", "yellow"] },
  { id: "orange", aliases: ["laranja", "orange"] },
];
const USED_PATTERN = /\b(?:semi\s*novo|seminovo|usado|usada|used|pre\s*owned|preowned|not\s+new|nao\s+novo|recondicionado|recondicionada|refurbished|renewed|restaurado|restaurada|open\s*box|vitrine|mostruario|grade\s*[a-z])\b/i;
const NEW_PATTERN = /\b(?:novo|novos|lacrado|lacrados|selado|selados|sealed|brand\s*new)\b/i;
const TRUSTED_RETAILER_PATTERN = /\b(?:amazon(?:\.com\.br)?|magalu|magazine\s*luiza|carrefour|kabum|fast\s*shop|iplace|apple|vivo|claro|tim|casas\s*bahia|ponto|extra|mercado\s*livre|mercadolivre|br\s*celulares|bne\s*store|line\s*express)\b/i;
const INCONSISTENT_IQR_RATIO = 0.25;
const ZERO_MAD_OUTLIER_RATIO = 0.35;

function normalizeRawText(value: string): string {
  return value
    .replace(/\bpro\s*\+/gi, " proplus ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function normalizeResearchText(value: string): string {
  return normalizeRawText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

export function cleanResearchName(value: string): string {
  return value
    .replace(/\bgrade\s*[a-z]\b/gi, " ")
    .replace(/\b(?:novo|novos|lacrado|lacrados|selado|selados|na caixa|original)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeResearchText(value)
    .replace(/\b(\d+)(gb|tb)\b/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
}

function compact(value: string): string {
  return normalizeResearchText(value).replace(/\s+/g, "");
}

function colorGroupsIn(value: string): Set<string> {
  const valueTokens = new Set(tokens(value));
  return new Set(COLOR_GROUPS.filter(group => group.aliases.some(alias => valueTokens.has(normalizeResearchText(alias)))).map(group => group.id));
}

function modelCodes(value: string): Set<string> {
  return new Set(tokens(value).filter(token => {
    if (token === "4g" || token === "5g") return false;
    if (/^\d{1,3}w$/.test(token) || /^20\d{2}$/.test(token)) return false;
    if (/(?:gb|tb)$/.test(token)) return false;
    return /^(?:[a-z]{1,4}\d+[a-z]?|\d+[a-z]{1,3})$/.test(token) && /\d/.test(token);
  }));
}

function memorySignature(value: string): { storage: number | null; ram: number | null } | null {
  const normalized = normalizeRawText(value);
  const slash = normalized.match(/\b(\d{2,5})\s*(?:gb)?\s*\/\s*(\d{1,2})(?:\s*\+\s*\d{1,2})?\s*(?:gb)?\b/);
  if (slash) return { storage: Number(slash[1]), ram: Number(slash[2]) };

  const capacities = [...normalized.matchAll(/\b(\d{2,5})\s*(gb|tb)\b/g)].map(match => {
    const amount = Number(match[1]);
    return match[2] === "tb" ? amount * 1024 : amount;
  });
  if (!capacities.length) return null;
  return { storage: capacities[0], ram: capacities.length > 1 ? capacities[1] : null };
}

function hasBrandAlias(token: string, titleTokens: Set<string>): boolean {
  return BRAND_ALIASES.some(group => group.has(token) && [...group].some(alias => titleTokens.has(alias)));
}

function productMismatchReason(query: string, title: string): string | null {
  const queryTokens = new Set(tokens(query));
  const titleTokens = new Set(tokens(title));
  const queryColors = colorGroupsIn(query);
  const titleColors = colorGroupsIn(title);
  const queryModelCodes = modelCodes(query);
  const titleModelCodes = modelCodes(title);
  const titleCompact = compact(title);

  for (const color of queryColors) {
    if (!titleColors.has(color)) return "A cor do anúncio não corresponde à cor informada pelo fornecedor.";
  }

  for (const token of titleTokens) {
    if (VARIANT_WORDS.has(token) && !queryTokens.has(token)) {
      return `O anúncio indica a variante “${token.toUpperCase()}”, diferente da lista do fornecedor.`;
    }
  }

  const queryMemory = memorySignature(query);
  const titleMemory = memorySignature(title);
  if (queryMemory && !titleMemory) return "A capacidade de armazenamento/RAM do anúncio não pôde ser confirmada.";
  if (!queryMemory && titleMemory) return "A lista do fornecedor não informa a capacidade; não é possível confirmar equivalência exata.";
  if (queryMemory && titleMemory && (queryMemory.storage !== titleMemory.storage || (queryMemory.ram != null && queryMemory.ram !== titleMemory.ram))) {
    return "A capacidade de armazenamento ou RAM do anúncio é diferente da lista do fornecedor.";
  }

  for (const token of queryTokens) {
    if (STOP_WORDS.has(token) || COLOR_GROUPS.some(group => group.aliases.includes(token))) continue;
    if (titleTokens.has(token) || hasBrandAlias(token, titleTokens)) continue;
    if ([...queryModelCodes].some(code => code === token && titleCompact.includes(code))) continue;
    return `O título não confirma o atributo “${token}” do produto pesquisado.`;
  }

  for (const code of queryModelCodes) {
    if (!titleModelCodes.has(code) && !titleCompact.includes(code)) {
      return `O código exato do modelo “${code.toUpperCase()}” não aparece no anúncio.`;
    }
  }
  for (const code of titleModelCodes) {
    if (!queryModelCodes.has(code) && queryTokens.has(code) === false && !/(?:gb|tb)$/.test(code)) {
      return `O anúncio indica a variante “${code.toUpperCase()}”, diferente da lista do fornecedor.`;
    }
  }

  return null;
}

function parsePrice(result: ShoppingResult): number | null {
  const extracted = Number(result.extracted_price);
  if (Number.isFinite(extracted) && extracted > 0) return extracted;
  const raw = String(result.price || "").replace(/[^0-9,.-]/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function listingText(result: ShoppingResult, title: string): string {
  const extensions = Array.isArray(result.extensions) ? result.extensions.map(String).join(" ") : String(result.extensions || "");
  return [title, result.condition, result.snippet, result.description, extensions].filter(Boolean).map(String).join(" ");
}

function hasExplicitNewCondition(result: ShoppingResult, text: string, seller: string): boolean {
  const condition = normalizeResearchText(String(result.condition || ""));
  return /\b(?:new|novo|novos|lacrado|lacrados|selado|selados|sealed)\b/.test(condition)
    || NEW_PATTERN.test(normalizeResearchText(text))
    || TRUSTED_RETAILER_PATTERN.test(normalizeResearchText(seller));
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function quantile(values: number[], probability: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function outlierIndexes(values: number[]): Set<number> {
  if (values.length < MINIMUM_COMPARABLE_EVIDENCE) return new Set();
  const center = median(values);
  const deviations = values.map(value => Math.abs(value - center));
  const mad = median(deviations);
  const outliers = new Set<number>();
  values.forEach((value, index) => {
    const difference = Math.abs(value - center);
    const outlier = mad > 0
      ? 0.6745 * difference / mad > 3.5
      : center > 0 && difference / center > ZERO_MAD_OUTLIER_RATIO;
    if (outlier) outliers.add(index);
  });
  return outliers;
}

function stats(values: number[]) {
  if (!values.length) return { min: null, median: null, max: null };
  return { min: Math.min(...values), median: median(values), max: Math.max(...values) };
}

function moneyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function evaluateShoppingResults(
  productName: string,
  rawResults: unknown[],
  collectedAt = new Date().toISOString(),
): MarketResearchSummary {
  const query = cleanResearchName(productName);
  const sources: MarketEvidence[] = [];
  const seen = new Set<string>();

  for (const value of rawResults) {
    const result = (value && typeof value === "object" ? value : {}) as ShoppingResult;
    const title = String(result.title || "").trim() || "Resultado sem título";
    const price = parsePrice(result);
    const rawUrl = String(result.product_link || result.link || "").trim();
    let url: string | null = null;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.toString();
    } catch { /* A URL inválida será registrada como evidência rejeitada. */ }
    const seller = String(result.source || "Google Shopping").trim();
    const text = listingText(result, title);
    const usedListing = USED_PATTERN.test(normalizeResearchText(text));
    let rejectionReason: string | null = null;

    if (title === "Resultado sem título") rejectionReason = "Título ausente no resultado.";
    else if (price == null) rejectionReason = "Preço ausente ou inválido.";
    else if (!url) rejectionReason = "Link do anúncio ausente ou inválido.";
    else if (usedListing) rejectionReason = "O anúncio indica usado, seminovo, recondicionado, vitrine ou Grade A.";
    else rejectionReason = productMismatchReason(query, title);
    const explicitNew = hasExplicitNewCondition(result, text, seller);
    if (!rejectionReason && !explicitNew) rejectionReason = "Condição novo/lacrado não está comprovada no título, condição ou atributos do anúncio.";

    const key = `${normalizeResearchText(title)}:${price ?? "sem-preco"}:${normalizeResearchText(seller)}:${url || "sem-link"}`;
    if (seen.has(key)) rejectionReason = "Anúncio duplicado; contado apenas uma vez.";
    seen.add(key);

    sources.push({
      source: "serpapi",
      title: seller ? `${title} — ${seller}` : title,
      price,
      url,
      condition: explicitNew && !usedListing ? "new" : "unverified",
      collected_at: collectedAt,
      status: rejectionReason ? "rejected" : "comparable",
      acceptance_reason: rejectionReason ? null : "Modelo, variante, capacidade e condição nova/lacrada confirmados no anúncio.",
      rejection_reason: rejectionReason,
    });
  }

  const preliminary = sources.filter(source => source.status === "comparable" && source.price != null);
  const preliminaryPrices = preliminary.map(source => source.price as number);
  const outliers = outlierIndexes(preliminaryPrices);
  preliminary.forEach((source, index) => {
    if (!outliers.has(index)) return;
    const center = median(preliminaryPrices);
    const distance = center > 0 ? Math.abs((source.price as number) - center) / center * 100 : 0;
    source.status = "rejected";
    source.acceptance_reason = null;
    source.rejection_reason = `Preço atípico: ${moneyBRL(source.price as number)}, ${distance.toFixed(1).replace(".", ",")}% distante da mediana inicial (${moneyBRL(center)}).`;
  });

  const comparable = sources.filter(source => source.status === "comparable" && source.price != null);
  const prices = comparable.map(source => source.price as number);
  const market = stats(prices);
  const rejectedCount = sources.filter(source => source.status === "rejected").length;
  let qualityStatus: MarketQualityStatus = "insufficient_evidence";
  let qualityNote: string;

  if (prices.length < MINIMUM_COMPARABLE_EVIDENCE) {
    qualityNote = prices.length === 0
      ? `Nenhum anúncio comprovadamente comparável. São necessários pelo menos ${MINIMUM_COMPARABLE_EVIDENCE} anúncios novos/lacrados.`
      : `Referência inconclusiva: ${prices.length}/${MINIMUM_COMPARABLE_EVIDENCE} anúncios comparáveis após as rejeições. A mediana é apenas indicativa e não aprova preço de mercado.`;
  } else {
    const spreadRatio = market.median ? (quantile(prices, 0.75) - quantile(prices, 0.25)) / market.median : 0;
    if (spreadRatio > INCONSISTENT_IQR_RATIO) {
      qualityStatus = "suspect";
      qualityNote = `Referência suspeita: a dispersão central dos anúncios é ${(spreadRatio * 100).toFixed(1).replace(".", ",")}% da mediana. Revise as evidências antes de usar o preço.`;
    } else {
      qualityStatus = "approved";
      qualityNote = `Referência aprovada com ${prices.length} anúncios comparáveis, novos/lacrados e sem dispersão suspeita.`;
    }
  }

  return {
    sources,
    ...market,
    evidence_count: comparable.length,
    found_count: rawResults.length,
    rejected_count: rejectedCount,
    quality_status: qualityStatus,
    quality_note: qualityNote,
  };
}
