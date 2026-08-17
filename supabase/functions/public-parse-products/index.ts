import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT_TXT = (content: string) => `Você é um parser de produtos para um Gestor Financeiro Empresarial. Extraia os produtos do TEXTO abaixo.
Para cada produto retorne: name, price (number), cost_price (number, 0 se não houver), category (inferida do nome), sku ("" se não houver), barcode ("" se não houver), stock_quantity (number, 0 se não houver), description (curta).
Responda APENAS com JSON válido neste formato exato, sem markdown:
{"products":[{"name":"...","price":0,"cost_price":0,"category":"...","sku":"","barcode":"","stock_quantity":0,"description":""}]}

TEXTO:
${content}`;

const PROMPT_XML = (content: string) => `Você é um parser de produtos para um Gestor Financeiro Empresarial. Extraia os produtos deste XML (pode ser NF-e, ERP export ou catálogo).
Para cada produto: name, price (number), cost_price (number, 0 se não houver), category, sku, barcode, stock_quantity, description.
Responda APENAS com JSON válido, sem markdown:
{"products":[{"name":"...","price":0,"cost_price":0,"category":"...","sku":"","barcode":"","stock_quantity":0,"description":""}]}

XML:
${content}`;

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; }
interface ParsedProduct {
  name: string;
  price: number;
  cost_price: number;
  category: string;
  sku: string;
  barcode: string;
  stock_quantity: number;
  description: string;
}

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanCategoryName(value: string) {
  return value
    .replace(/^[-=\s]+|[-=\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isSectionHeader(line: string) {
  const trimmed = line.trim();
  return /^[-=*\s]*[A-ZÀ-Ý0-9 ]+[A-ZÀ-Ý0-9][-=*\s]*$/u.test(trimmed) && !/(?:R\$|\d[,.]\d{2})/.test(trimmed);
}

function parsePrice(rawPrice: string) {
  const normalized = rawPrice.replace(/\./g, "").replace(",", ".").trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function looksLikeProductLine(line: string) {
  return /(?:^|\s[-–—:]\s|\s)(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})$/.test(line.trim());
}

function inferCategory(name: string, fallback = "Geral") {
  const text = normalizeText(name);
  if (/(refri|cerveja|agua|suco|bebida|vinho|whisky|drink)/.test(text)) return "Bebidas";
  if (/(salgad|coxinha|pastel|esfiha|kibe|empada)/.test(text)) return "Salgados";
  if (/(doce|brigadeiro|bolo|torta|sobremesa|pudim)/.test(text)) return "Doces";
  if (/(pizza|calzone)/.test(text)) return "Pizzas";
  if (/(burger|hamburguer|x-|cheese)/.test(text)) return "Lanches";
  return fallback || "Geral";
}

function parseTxtLocally(content: string): ParsedProduct[] {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const products: ParsedProduct[] = [];
  let currentCategory = "Geral";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isSectionHeader(line)) {
      currentCategory = cleanCategoryName(line.replace(/^[-=*\s]+|[-=*\s]+$/g, ""));
      continue;
    }
    const match = line.match(/^(.*?)(?:\s*[-–—:]\s*|\s+)(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{2})?)$/i);
    if (!match) continue;
    const [, rawName, rawPrice] = match;
    const name = rawName.trim();
    if (!name) continue;

    const descLines: string[] = [];
    let cursor = i + 1;
    while (cursor < lines.length && !isSectionHeader(lines[cursor]) && !looksLikeProductLine(lines[cursor])) {
      descLines.push(lines[cursor]);
      cursor++;
    }

    products.push({
      name,
      price: parsePrice(rawPrice),
      cost_price: 0,
      category: inferCategory(name, currentCategory),
      sku: "",
      barcode: "",
      stock_quantity: 0,
      description: descLines.join(" ").slice(0, 280),
    });
    i = cursor - 1;
  }
  return products;
}

function parseXmlLocally(content: string): ParsedProduct[] {
  const products: ParsedProduct[] = [];
  // NF-e style: each <det> or <prod> block
  const blockRegex = /<(?:det|prod|product|item|produto)\b[^>]*>([\s\S]*?)<\/(?:det|prod|product|item|produto)>/gi;
  const matches = [...content.matchAll(blockRegex)];

  const extract = (block: string, tags: string[]): string => {
    for (const t of tags) {
      const re = new RegExp(`<${t}[^>]*>([^<]+)<\\/${t}>`, "i");
      const m = block.match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return "";
  };

  for (const m of matches) {
    const block = m[1];
    const name = extract(block, ["xProd", "name", "descricao", "nome", "titulo", "descrição"]);
    if (!name) continue;
    const priceStr = extract(block, ["vUnCom", "preco", "price", "valor", "vlr_venda", "vUnTrib"]);
    const costStr = extract(block, ["vUnTrib", "custo", "cost", "preco_custo", "vlr_custo"]);
    const sku = extract(block, ["cProd", "sku", "codigo", "cod"]);
    const barcode = extract(block, ["cEAN", "ean", "barcode", "gtin"]);
    const qtyStr = extract(block, ["qCom", "qtd", "estoque", "stock", "quantidade", "qTrib"]);
    const category = extract(block, ["categoria", "category", "grupo", "familia", "CFOP"]) || inferCategory(name);

    products.push({
      name,
      price: parseFloat(priceStr.replace(",", ".")) || 0,
      cost_price: parseFloat(costStr.replace(",", ".")) || 0,
      category: category || "Geral",
      sku: sku || "",
      barcode: (barcode && barcode !== "SEM GTIN") ? barcode : "",
      stock_quantity: parseFloat(qtyStr.replace(",", ".")) || 0,
      description: "",
    });
  }
  return products;
}

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase.from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}

async function getAiWorkers(supabase: any) {
  const { data } = await supabase.from("ai_workers").select("id, base_url")
    .eq("is_active", true).eq("is_exhausted", false)
    .in("worker_type", ["txt", "chat"])
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as AiWorker[];
}

function safeJsonParse(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

async function tryGoogle(prompt: string, keys: ApiKeyEntry[], supabase: any): Promise<any | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];
  for (const keyEntry of allKeys) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        }
      );
      if (response.status === 429 || response.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!response.ok) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = safeJsonParse(textContent);
      if (parsed) return parsed;
    } catch (e) { console.error("Google attempt failed:", e); continue; }
  }
  return null;
}

async function tryLovable(prompt: string): Promise<any | null> {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Responda APENAS com JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return safeJsonParse(data.choices?.[0]?.message?.content);
  } catch { return null; }
}

async function tryOpenRouter(prompt: string): Promise<any | null> {
  const KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [
          { role: "system", content: "Responda APENAS com JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return safeJsonParse(data.choices?.[0]?.message?.content);
  } catch { return null; }
}

async function tryWorker(prompt: string, workers: AiWorker[], supabase: any): Promise<any | null> {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-parse-txt`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txtContent: prompt }),
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        continue;
      }
      if (!response.ok) continue;
      const ct = response.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        await supabase.from("ai_workers").update({ is_active: false }).eq("id", worker.id);
        continue;
      }
      await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
      return await response.json();
    } catch { continue; }
  }
  return null;
}

function normalizeProducts(raw: any): ParsedProduct[] {
  const list = Array.isArray(raw?.products) ? raw.products : Array.isArray(raw) ? raw : [];
  return list.map((p: any) => ({
    name: String(p.name || p.nome || "").trim(),
    price: Number(p.price ?? p.preco ?? 0) || 0,
    cost_price: Number(p.cost_price ?? p.custo ?? 0) || 0,
    category: String(p.category || p.categoria || "Geral"),
    sku: String(p.sku || p.codigo || ""),
    barcode: String(p.barcode || p.ean || ""),
    stock_quantity: Number(p.stock_quantity ?? p.estoque ?? 0) || 0,
    description: String(p.description || p.descricao || "").slice(0, 280),
  })).filter((p: ParsedProduct) => p.name);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const fileType: string = (body.fileType || "").toLowerCase();
    const content: string = body.content || "";

    if (!content || typeof content !== "string") {
      return new Response(JSON.stringify({ error: "content é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (!["txt", "xml"].includes(fileType)) {
      return new Response(JSON.stringify({ error: "fileType deve ser 'txt' ou 'xml'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = getSupabaseAdmin();

    // 1) Parser local primeiro
    const localProducts = fileType === "txt" ? parseTxtLocally(content) : parseXmlLocally(content);
    if (localProducts.length >= 3) {
      console.info(`public-parse-products: parser local resolveu (${localProducts.length} itens, ${fileType})`);
      return new Response(JSON.stringify({ products: localProducts, source: "local" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2) Cascata de IA
    const prompt = fileType === "txt" ? PROMPT_TXT(content) : PROMPT_XML(content);
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAiWorkers(supabase)]);

    for (const [name, fn] of [
      ["google", () => tryGoogle(prompt, keys, supabase)],
      ["lovable", () => tryLovable(prompt)],
      ["openrouter", () => tryOpenRouter(prompt)],
      ["worker", () => tryWorker(prompt, workers, supabase)],
    ] as const) {
      const result = await fn();
      const products = normalizeProducts(result);
      if (products.length > 0) {
        console.info(`public-parse-products: ${name} resolveu (${products.length} itens)`);
        return new Response(JSON.stringify({ products, source: name }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 3) Fallback: retorna o que o local achou mesmo se for pouco
    if (localProducts.length > 0) {
      return new Response(JSON.stringify({ products: localProducts, source: "local-fallback" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      error: "Não consegui interpretar o arquivo. Verifique se o formato está correto (TXT com linhas tipo 'Nome - R$ 35,00' ou XML com tags reconhecíveis)."
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("public-parse-products error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
