import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

type InputItem = { name: string };
type MarketSource = {
  source: "serpapi";
  title: string;
  price: number;
  url: string;
  condition: "new";
  collected_at: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return normalize(value).split(/\s+/).filter((token) => token.length >= 2);
}

function cleanResearchName(value: string) {
  return value
    .replace(/\bgrade\s*[a-z]\b/gi, " ")
    .replace(/\b(?:novo|lacrado|na caixa|original)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function equivalent(query: string, title: string) {
  const queryTokens = tokens(query).filter((token) => !["com", "para", "de", "novo", "lacrado", "original", "gb", "tb"].includes(token));
  const titleTokens = new Set(tokens(title));
  if (!queryTokens.length) return false;

  const numeric = queryTokens.filter((token) => /^\d+$/.test(token) && token.length >= 2);
  const textual = queryTokens.filter((token) => !/^\d+$/.test(token));
  const numericMatch = numeric.every((token) => titleTokens.has(token));
  const textualMatches = textual.filter((token) => titleTokens.has(token)).length;
  const textualRequired = Math.min(textual.length, textual.length <= 2 ? textual.length : 2);
  return numericMatch && textualMatches >= textualRequired;
}

function isUsedListing(value: string) {
  return /\b(seminovo|semi\s*novo|usado|recondicionado|refurbished|restaurado|grade\s*[a-z])\b/i.test(normalize(value));
}

function parsePrice(result: any) {
  const extracted = Number(result?.extracted_price);
  if (Number.isFinite(extracted) && extracted > 0) return extracted;
  const raw = String(result?.price || "").replace(/[^0-9,.-]/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function authUser(req: Request) {
  const header = req.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data } = await client.auth.getUser(header.slice(7));
  return data.user || null;
}

async function canAccess(tenantId: string, userId: string) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: superAdmin } = await admin.from("platform_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (superAdmin) return true;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId).eq("role", "admin").eq("approved", true).maybeSingle();
  return !!role;
}

async function searchMarket(name: string): Promise<MarketSource[]> {
  const apiKey = Deno.env.get("SERPAPI_KEY");
  if (!apiKey) throw new Error("SERPAPI_KEY não configurada.");

  const searchName = cleanResearchName(name);
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", `${searchName} novo lacrado`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("gl", "br");
  url.searchParams.set("hl", "pt-BR");
  url.searchParams.set("google_domain", "google.com.br");
  url.searchParams.set("device", "desktop");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`SerpAPI indisponível (HTTP ${response.status}).`);
  const data = await response.json();
  if (data?.error) throw new Error(`SerpAPI: ${String(data.error)}`);

  const collectedAt = new Date().toISOString();
  const unique = new Set<string>();
  const sources: MarketSource[] = [];
  for (const result of Array.isArray(data?.shopping_results) ? data.shopping_results : []) {
    const title = String(result?.title || "").trim();
    const price = parsePrice(result);
    const link = String(result?.product_link || result?.link || "").trim();
    if (!title || !link || price == null || isUsedListing(title) || !equivalent(searchName, title)) continue;
    const sourceName = String(result?.source || "Google Shopping").trim();
    const key = `${normalize(title)}:${price.toFixed(2)}:${sourceName}`;
    if (unique.has(key)) continue;
    unique.add(key);
    sources.push({ source: "serpapi", title: `${title} — ${sourceName}`, price, url: link, condition: "new", collected_at: collectedAt });
  }
  return sources.slice(0, 10);
}

async function inBatches<T>(items: T[], worker: (item: T) => Promise<T>, concurrency = 3) {
  const output: T[] = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return output;
}

function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return { min: null, median: null, max: null };
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  return { min: ordered[0], median, max: ordered[ordered.length - 1] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const user = await authUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await req.json();
    const tenantId = String(body?.tenantId || "").trim();
    const inputItems = Array.isArray(body?.items) ? body.items as InputItem[] : [];
    if (!tenantId || !inputItems.length || inputItems.length > 40) return json({ error: "invalid_input" }, 400);
    if (!(await canAccess(tenantId, user.id))) return json({ error: "forbidden" }, 403);

    const items = await inBatches(inputItems, async (item) => {
      const name = String(item?.name || "").trim();
      if (!name) return { name, sources: [], ...stats([]), evidence_count: 0, demand_note: "Demanda estimada; a busca não prova volume de vendas." };
      try {
        const sources = await searchMarket(name);
        const market = stats(sources.map((source) => source.price));
        return { name, sources, ...market, evidence_count: sources.length, demand_note: "Demanda estimada; a busca de anúncios não prova volume de vendas." };
      } catch (error) {
        console.error("serpapi_market_search_failed", name, error);
        return { name, sources: [], ...stats([]), evidence_count: 0, demand_note: error instanceof Error ? error.message : "Pesquisa inconclusiva; a SerpAPI não respondeu." };
      }
    });
    return json({ source: "serpapi_google_shopping", items, researched_at: new Date().toISOString() });
  } catch (error) {
    console.error("market_price_research_error", error);
    return json({ error: "research_failed" }, 500);
  }
});
