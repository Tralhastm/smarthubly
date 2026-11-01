import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

type InputItem = { name: string };
type MarketSource = {
  source: "mercadolivre";
  title: string;
  price: number;
  url: string;
  condition: string;
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
  return normalize(value).split(/\s+/).filter((token) => token.length >= 2 && !["com", "para", "novo", "original", "lacrado", "gb", "tb"].includes(token));
}

function equivalent(query: string, title: string) {
  const titleText = normalize(title);
  const required = tokens(query);
  if (!required.length) return false;
  const critical = required.filter((token) => /\d/.test(token) || token.length >= 3);
  const hits = critical.filter((token) => titleText.includes(token)).length;
  return hits >= Math.max(1, Math.ceil(critical.length * 0.7));
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
  const url = new URL("https://api.mercadolibre.com/sites/MLB/search");
  url.searchParams.set("q", name);
  url.searchParams.set("limit", "20");
  url.searchParams.set("condition", "new");
  url.searchParams.set("sort", "relevance");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    console.error("market_source_unavailable", response.status, name);
    throw new Error(`Fonte de mercado indisponível (HTTP ${response.status}).`);
  }
  const data = await response.json();
  const collectedAt = new Date().toISOString();
  const unique = new Set<string>();
  const sources: MarketSource[] = [];
  for (const result of Array.isArray(data?.results) ? data.results : []) {
    const price = Number(result?.price);
    const permalink = String(result?.permalink || "").trim();
    const title = String(result?.title || "").trim();
    if (!title || !permalink || !Number.isFinite(price) || price <= 0 || !equivalent(name, title)) continue;
    const key = `${normalize(title)}:${price.toFixed(2)}`;
    if (unique.has(key)) continue;
    unique.add(key);
    sources.push({ source: "mercadolivre", title, price, url: permalink, condition: "new", collected_at: collectedAt });
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
      if (!name) return { name, sources: [], ...stats([]), evidence_count: 0, demand_note: "Demanda estimada; a busca de anúncios não prova volume de vendas." };
      try {
        const sources = await searchMarket(name);
        const market = stats(sources.map((source) => source.price));
        return {
          name,
          sources,
          ...market,
          evidence_count: sources.length,
          demand_note: "Demanda estimada; a busca de anúncios não prova volume de vendas.",
        };
      } catch (error) {
        console.error("market_search_failed", name, error);
        return { name, sources: [], ...stats([]), evidence_count: 0, demand_note: "Pesquisa inconclusiva; a fonte não respondeu." };
      }
    });
    return json({ source: "mercadolivre", items, researched_at: new Date().toISOString() });
  } catch (error) {
    console.error("market_price_research_error", error);
    return json({ error: "research_failed" }, 500);
  }
});
