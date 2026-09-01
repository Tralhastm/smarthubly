import { json } from "../../../_shared/router.ts";
import { corsHeaders } from "../../../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

interface ParsedVariant {
  name: string;
  price: number;
  cost_price: number;
  resale_price: number;
}

interface ParsedProduct {
  name: string;
  price: number;
  cost_price: number;
  resale_price: number;
  category: string;
  description: string;
  variants?: ParsedVariant[];
  needs_price_review?: boolean;
}

function parsePrice(raw: string): number {
  const value = String(raw || "")
    .replace(/R\$|\s/gi, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(/,/g, ".");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function cleanName(value: string): string {
  return normalize(value)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/^\s*[-–—*•]+\s*/, "")
    .replace(/\s*[-–—:]\s*$/, "")
    .replace(/[：:]\s*$/, "")
    .trim();
}

function isPriceLine(line: string): boolean {
  return /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?(?:\s*)$/.test(line.trim())
    || /(?:R\$\s*)?\d+(?:[.,]\d{1,2})?(?:\s*)$/.test(line.trim());
}

function isHeader(line: string): boolean {
  const clean = line.replace(/^[-=*_#\s]+|[-=*_#\s]+$/g, "").trim();
  if (!clean || /R\$|\d[,.]\d{1,2}/i.test(clean)) return false;
  return /^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 /&+.-]*$/u.test(clean) && clean.length <= 45;
}

function extractLabeledPrice(line: string, labels: string[]): number {
  const label = labels.join("|");
  const match = line.match(new RegExp(`(?:${label})\\s*:?\\s*R?\\$?\\s*([\\d.]+(?:,\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)`, "i"));
  return match ? parsePrice(match[1]) : 0;
}

function extractAnyPrice(line: string): number {
  const match = line.match(/R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  return match ? parsePrice(match[1]) : 0;
}

function inferCategory(name: string, section: string): string {
  if (section && section !== "Geral") return section;
  const lower = name.toLocaleLowerCase("pt-BR");
  if (/iphone|galaxy|moto|redmi|poco|realme|xiaomi|celular|smartphone|samsung/.test(lower)) return "Celulares";
  if (/notebook|laptop|tablet|ipad/.test(lower)) return "Informática";
  return "Geral";
}

/**
 * Aceita tanto uma linha única ("Produto - R$ 35,00") quanto catálogos em
 * blocos, por exemplo:
 * MARCA\nProduto\nCusto: R$ 750\nVenda sugerida: R$ 849.
 * Também preserva formatos com CUSTO/REVENDA na mesma linha.
 */
function parseCatalogLegacy(text: string, priceType: string): ParsedProduct[] {
  const lines = String(text || "").split(/\r?\n/).map(normalize);
  const products: ParsedProduct[] = [];
  let section = "Geral";
  let current: { name: string; section: string; cost: number; resale: number; generic: number } | null = null;

  const flush = () => {
    if (!current) return;
    const cost = current.cost || 0;
    const resale = current.resale || 0;
    const selected = priceType === "cost" || priceType === "both" ? cost || resale : resale || cost || current.generic;
    if (current.name && selected > 0) {
      products.push({
        name: current.name,
        price: selected,
        cost_price: cost,
        resale_price: resale,
        category: inferCategory(current.name, current.section),
        description: "",
      });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeader(line)) {
      flush();
      section = line.replace(/^[-=*_#\s]+|[-=*_#\s]+$/g, "").trim();
      continue;
    }

    const cost = extractLabeledPrice(line, ["custo", "cost", "preço de custo", "preco de custo"]);
    const resale = extractLabeledPrice(line, ["venda sugerida", "venda", "revenda", "resale", "preço de venda", "preco de venda"]);
    const hasLabel = cost > 0 || resale > 0 || /(?:custo|venda|revenda|resale)/i.test(line);
    const inlineCost = extractLabeledPrice(line, ["custo"]);
    const inlineResale = extractLabeledPrice(line, ["venda sugerida", "revenda", "venda"]);

    if (current && (cost > 0 || resale > 0 || hasLabel)) {
      current.cost = current.cost || inlineCost;
      current.resale = current.resale || inlineResale;
      if (!inlineCost && !inlineResale && isPriceLine(line)) current.generic = extractAnyPrice(line);
      continue;
    }

    if (cost > 0 || resale > 0) {
      // Formato antigo: produto e rótulos na mesma linha.
      const nameBeforeLabel = cleanName(line.split(/\b(?:custo|venda sugerida|venda|revenda|resale|preço de custo|preco de custo|preço de venda|preco de venda)\b/i)[0].replace(/[-–—:]+\s*$/, ""));
      if (nameBeforeLabel && !/^(?:custo|venda|revenda|resale|preço|preco)$/i.test(nameBeforeLabel)) {
        const selected = priceType === "cost" || priceType === "both" ? cost || resale : resale || cost;
        products.push({ name: nameBeforeLabel, price: selected, cost_price: cost, resale_price: resale, category: inferCategory(nameBeforeLabel, section), description: "" });
      }
      continue;
    }

    const inlinePrice = extractAnyPrice(line);
    const genericMatch = line.match(/^(.*?)(?:\s*[-–—:]\s*|\s+)(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*$/i);
    if (genericMatch) {
      flush();
      const name = cleanName(genericMatch[1]);
      const price = parsePrice(genericMatch[2]);
      if (name && price > 0) products.push({ name, price, cost_price: 0, resale_price: price, category: inferCategory(name, section), description: "" });
      continue;
    }
    const looksLikeStandaloneProduct = !isPriceLine(line) && !/^(?:custo|venda|revenda|resale|preço|preco)\b/i.test(line);
    if (looksLikeStandaloneProduct) {
      flush();
      current = { name: cleanName(line), section, cost: 0, resale: 0, generic: 0 };
      continue;
    }

    if (current && inlinePrice > 0) current.generic = inlinePrice;
  }
  flush();
  return products;
}

const COLOR_WORDS = /preto|preta|pret[oa]s?|azul|azuis|verde|verdes|branco|branca|brancos|brancas|roxo|roxa|roxos|dourado|dourada|gold|prata|cinza|laranja|rosa|camuflada|camuflado|marrom|titanium|black|white|storm/i;

function splitVariationNames(raw: string): string[] {
  const suffix = normalize(raw.replace(/[()*]+/g, "").replace(/^[-–—:,\s]+|[-–—:,\s]+$/g, ""));
  if (!suffix || /^(?:conferir disponibilidade|disponibilidade a confirmar)$/i.test(suffix)) return [];
  const parts = suffix.split(/,|\s+e\s+/i).map(normalize).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => COLOR_WORDS.test(part))) return [...new Set(parts)];
  return [suffix];
}

function selectedPrice(cost: number, resale: number, generic: number, priceType: string): number {
  return priceType === "cost" || priceType === "both" ? cost || resale || generic : resale || cost || generic;
}

function makeParsedProduct(name: string, price: number, section: string, suffix: string, priceType: string): ParsedProduct {
  const clean = cleanName(name);
  const variations = splitVariationNames(suffix);
  const selected = selectedPrice(price, price, 0, priceType);
  return {
    name: clean,
    price: selected,
    cost_price: price,
    resale_price: price,
    category: inferCategory(clean, section),
    description: "",
    variants: variations.map((variantName) => ({ name: variantName, price: selected, cost_price: price, resale_price: price })),
  };
}

/** Parser flexível para linhas de fornecedor com preço seguido de cores/atributos. */
function parseCatalog(text: string, priceType: string): ParsedProduct[] {
  const lines = String(text || "").split(/\r?\n/).map(normalize);
  const records: ParsedProduct[] = [];
  let section = "Geral";
  let pending: { name: string; section: string; cost: number; resale: number; generic: number } | null = null;

  const flushPending = () => {
    if (!pending) return;
    const price = selectedPrice(pending.cost, pending.resale, pending.generic, priceType);
    if (pending.name && price > 0) {
      records.push({ name: pending.name, price, cost_price: pending.cost, resale_price: pending.resale, category: inferCategory(pending.name, pending.section), description: "", variants: [] });
    }
    pending = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeader(line)) {
      flushPending();
      section = line.replace(/^[-=*_#\s]+|[-=*_#\s]+$/g, "").trim();
      continue;
    }

    const cost = extractLabeledPrice(line, ["custo", "cost", "preço de custo", "preco de custo"]);
    const resale = extractLabeledPrice(line, ["venda sugerida", "venda", "revenda", "resale", "preço de venda", "preco de venda"]);
    if (cost > 0 || resale > 0) {
      const labelPos = line.search(/\b(?:custo|cost|venda sugerida|venda|revenda|resale|preço de custo|preco de custo|preço de venda|preco de venda)\b/i);
      const nameBeforeLabel = labelPos > 0 ? cleanName(line.slice(0, labelPos).replace(/[-–—:]+\s*$/, "")) : "";
      if (nameBeforeLabel) {
        const selected = selectedPrice(cost, resale, 0, priceType);
        records.push({ name: nameBeforeLabel, price: selected, cost_price: cost, resale_price: resale, category: inferCategory(nameBeforeLabel, section), description: "", variants: [] });
        pending = null;
      } else if (pending) {
        pending.cost = pending.cost || cost;
        pending.resale = pending.resale || resale;
      }
      continue;
    }

    const currencyMatch = line.match(/R\$\s*([\d.]+(?:,[\d]{1,2})?)/i);
    if (currencyMatch && currencyMatch.index != null) {
      flushPending();
      const prefix = line.slice(0, currencyMatch.index);
      const suffix = line.slice(currencyMatch.index + currencyMatch[0].length);
      const name = cleanName(prefix.replace(/[-–—:(*]+\s*$/, ""));
      if (name) records.push(makeParsedProduct(name, parsePrice(currencyMatch[1]), section, suffix, priceType));
      continue;
    }

    const genericMatch = line.match(/^(.*?)(?:\s*[-–—:]\s*)\(?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*\)?\s*\*?\s*(.*)$/i);
    if (genericMatch && !/\d+\s*(?:GB|TB|G|MP|")/i.test(genericMatch[1])) {
      flushPending();
      records.push(makeParsedProduct(genericMatch[1], parsePrice(genericMatch[2]), section, genericMatch[3], priceType));
      continue;
    }

    if (!/^(?:custo|venda|revenda|resale|preço|preco|conferir disponibilidade)\b/i.test(line)) {
      flushPending();
      pending = { name: cleanName(line), section, cost: 0, resale: 0, generic: 0 };
    }
  }
  flushPending();

  const grouped = new Map<string, ParsedProduct>();
  for (const record of records) {
    const key = normalize(record.name).toLocaleLowerCase("pt-BR");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...record, variants: [...(record.variants || [])] });
      continue;
    }
    const existingVariants = existing.variants || (existing.variants = []);
    for (const variant of record.variants || []) {
      if (!existingVariants.some((item) => item.name.toLocaleLowerCase("pt-BR") === variant.name.toLocaleLowerCase("pt-BR"))) existingVariants.push(variant);
    }
    if (existingVariants.length === 0 && record.price !== existing.price) {
      existingVariants.push({ name: `Opção ${existingVariants.length + 1}`, price: record.price, cost_price: record.cost_price, resale_price: record.resale_price });
    }
    const costs = [existing.cost_price, record.cost_price].filter((value) => value > 0);
    if (costs.length) existing.cost_price = Math.min(...costs);
    const prices = [existing.price, record.price].filter((value) => value > 0);
    if (prices.length) existing.price = Math.min(...prices);
    existing.needs_price_review = existingVariants.some((variant) => variant.cost_price > existing.cost_price);
  }
  return [...grouped.values()];
}

export default async function handler(req: Request, payload: any) {
  try {
    const { txtContent, supplierName, priceType, profitMargin, shippingFee, tenantId } = payload;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let targetSupplierId: string | null = null;
    if (supplierName) {
      const { data: existing } = await supabase.from("suppliers").select("id").eq("tenant_id", tenantId).ilike("name", supplierName.trim()).maybeSingle();
      if (existing) targetSupplierId = existing.id;
      else {
        const { data: newSup } = await supabase.from("suppliers").insert({ tenant_id: tenantId, name: supplierName.trim(), active: true }).select("id").single();
        targetSupplierId = newSup?.id || null;
      }
    }

    const products = parseCatalog(txtContent, priceType || "resale");
    if (targetSupplierId && products.length > 0) {
      const priceTypes = priceType === "both" ? ["cost", "resale"] : [priceType || "resale"];
      for (const p of products) {
        await supabase.from("supplier_product_prices").upsert({
          supplier_id: targetSupplierId,
          product_name: p.name.toLowerCase(),
          unit_price: p.cost_price || p.price,
          available: true,
          price_types: priceTypes,
          metadata: { resale_price: p.resale_price || null, profit_margin: Number(profitMargin) || 0, shipping_fee: Number(shippingFee) || 0, variants: p.variants || [], needs_price_review: Boolean(p.needs_price_review) },
        }, { onConflict: "supplier_id,product_name" });
      }
    }

    return json({ success: true, count: products.length, supplier_id: targetSupplierId, products });
  } catch (e) {
    console.error("[unified:parse-txt] error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export { parseCatalog };
