// Imports a product from an affiliate URL.
// Modes:
//   - useAi=false (default): apenas resolve a URL e detecta a rede. Não chama IA.
//   - useAi=true: usa IA pra extrair name/price/image/category/description.
// Provider order (igual aos demais): Google → Lovable → OpenRouter → AI Workers externos.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ImportRequest { url: string; useAi?: boolean }
interface ApiKeyEntry { id: string; api_key: string }
interface AiWorker { id: string; base_url: string; is_exhausted?: boolean }

const SHORT_LINK_HOSTS = [
  "meli.la", "mercadolivre.com/sec",
  "amzn.to", "a.co",
  "s.shopee.com.br", "shp.ee", "sho.pe",
  "s.click.aliexpress.com", "a.aliexpress.com",
  "bit.ly", "cutt.ly", "tinyurl.com", "rebrand.ly", "encr.pw",
  "magazine.lu", "magalu.cm",
];

const detectNetwork = (url: string, html = ""): string => {
  const u = url.toLowerCase();
  const h = html.toLowerCase().slice(0, 5000);
  if (u.includes("shopee") || u.includes("shp.ee") || u.includes("sho.pe")) return "shopee";
  if (u.includes("amazon") || u.includes("amzn") || u.includes("a.co")) return "amazon";
  if (u.includes("mercadolivre") || u.includes("mercadolibre") || u.includes("meli.la") || u.includes("mlb-")) return "mercadolivre";
  if (u.includes("aliexpress") || u.includes("aliexp")) return "aliexpress";
  if (u.includes("magazineluiza") || u.includes("magazinevoce") || u.includes("magalu")) return "magalu";
  if (u.includes("americanas")) return "americanas";
  if (u.includes("submarino")) return "submarino";
  if (u.includes("casasbahia") || u.includes("pontofrio") || u.includes("extra.com.br")) return "via";
  if (u.includes("kabum")) return "kabum";
  if (u.includes("shein")) return "shein";
  if (u.includes("temu")) return "temu";
  if (u.includes("hotmart")) return "hotmart";
  if (u.includes("monetizze")) return "monetizze";
  if (u.includes("eduzz")) return "eduzz";
  if (u.includes("kiwify")) return "kiwify";
  if (u.includes("braip")) return "braip";
  if (h.includes("shopify") || h.includes("cdn.shopify.com") || h.includes("shopify-buy")) return "shopify";
  if (h.includes("woocommerce")) return "woocommerce";
  return "outro";
};

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

// Algumas páginas (ML /gz/webdevice/config, Shopee /universal-link, etc) são
// "gateways" que carregam a URL real num query param tipo ?go=, ?url=, ?to=,
// ?redirect=, ?u=, ?target=. Detecta e segue.
function extractGatewayTarget(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const keys = ["go", "url", "to", "redirect", "redirectUrl", "u", "target", "next", "deep_link_value", "redir"];
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v && /^https?%3A|^https?:\/\//i.test(v)) {
        try { return decodeURIComponent(v); } catch { return v; }
      }
    }
    // Caminhos típicos: /gz/webdevice/config, /universal-link, /sec/...
    if (/\/(gz\/webdevice\/config|universal-link|deeplink|redirect)/i.test(u.pathname)) {
      // Sem param conhecido — desiste
      return null;
    }
    return null;
  } catch { return null; }
}

async function resolveUrl(input: string, maxHops = 10): Promise<string> {
  let current = input;
  for (let i = 0; i < maxHops; i++) {
    // 1) Gateway com URL no query param — pula direto pro destino
    const gw = extractGatewayTarget(current);
    if (gw && gw !== current) { current = gw; continue; }

    try {
      const res = await fetch(current, { method: "GET", redirect: "manual", headers: BROWSER_HEADERS });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status === 200) {
        const body = await res.text();
        const meta = body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i);
        if (meta) { current = new URL(meta[1], current).toString(); continue; }
        const js = body.match(/(?:window\.location(?:\.href)?|location\.replace)\s*=\s*["']([^"']+)["']/i);
        if (js) { current = new URL(js[1], current).toString(); continue; }
      }
      return current;
    } catch { return current; }
  }
  return current;
}

function extractStructured(html: string): string {
  const parts: string[] = [];
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) parts.push(`TITLE: ${titleMatch[1].trim().slice(0, 300)}`);
  const metaRegex = /<meta[^>]+(?:property|name|itemprop)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  let metaCount = 0;
  while ((m = metaRegex.exec(html)) !== null && metaCount < 60) {
    const key = m[1].toLowerCase();
    if (key.startsWith("og:") || key.startsWith("twitter:") || key.startsWith("product:") || key === "description" || key === "price" || key === "image" || key === "name") {
      parts.push(`META ${key}: ${m[2].slice(0, 400)}`);
      metaCount++;
    }
  }
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  let ldCount = 0;
  while ((ld = ldRegex.exec(html)) !== null && ldCount < 5) {
    parts.push(`JSON-LD: ${ld[1].trim().slice(0, 4000)}`);
    ldCount++;
  }
  const priceRegex = /(R\$|BRL|USD|\$)\s?([\d.,]+)/gi;
  let p: RegExpExecArray | null;
  const prices: string[] = [];
  while ((p = priceRegex.exec(html)) !== null && prices.length < 30) prices.push(p[0]);
  if (prices.length) parts.push(`PRICE_HINTS: ${prices.join(" | ")}`);
  return parts.join("\n").slice(0, 18000);
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
    return await res.text();
  } catch (e) { console.error("fetchHtml error", e); return ""; }
}

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase.from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}

async function getAllWorkers(supabase: any) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  return ([...(active || []), ...(exhausted || [])]) as AiWorker[];
}

const SYSTEM_PROMPT =
  "Você extrai dados de produtos de páginas HTML de e-commerce (Shopee, Amazon, Mercado Livre, AliExpress, Magalu, Americanas, Shein, Temu, Shopify, Hotmart, etc). " +
  "Use JSON-LD (schema.org Product) quando disponível. Caso contrário use as meta tags og:/twitter:/product: e por último as dicas de preço. " +
  "Retorne APENAS um JSON válido sem markdown, com as chaves: " +
  "name (string, nome curto e limpo), price (número decimal em reais BRL — converta de USD usando ~5.0), " +
  "image (URL absoluta https da imagem principal), " +
  "category (uma de: Eletrônicos, Casa, Moda, Beleza, Esportes, Pet, Brinquedos, Livros, Mercado, Saúde, Ferramentas, Auto, Infoprodutos, Geral), " +
  "description (1-2 frases objetivas). Se não conseguir, use string vazia ou 0. NUNCA invente.";

function buildUserPrompt(finalUrl: string, network: string, structured: string, rawSlice: string) {
  return `URL FINAL: ${finalUrl}\nREDE: ${network}\n\nDADOS ESTRUTURADOS:\n${structured}${rawSlice}`;
}

function parseJsonResponse(text: string): any | null {
  let cleaned = (text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a >= 0 && b > a) cleaned = cleaned.slice(a, b + 1);
  try { return JSON.parse(cleaned); } catch { return null; }
}

// ----- Providers -----
async function tryGoogle(userPrompt: string, keys: ApiKeyEntry[], supabase: any): Promise<any | null> {
  const all = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];
  for (const k of all) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k.api_key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      if (r.status === 429 || r.status === 403) {
        if (k.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", k.id);
        continue;
      }
      if (!r.ok) continue;
      if (k.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
      const data = await r.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = parseJsonResponse(text || "");
      if (parsed) return parsed;
    } catch (e) { console.error("Google fail", e); continue; }
  }
  return null;
}

async function tryLovable(userPrompt: string): Promise<any | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      }),
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok) return null;
    const data = await r.json();
    return parseJsonResponse(data.choices?.[0]?.message?.content || "");
  } catch { return null; }
}

async function tryOpenRouter(userPrompt: string): Promise<any | null> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      }),
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok) return null;
    const data = await r.json();
    return parseJsonResponse(data.choices?.[0]?.message?.content || "");
  } catch { return null; }
}

// Workers expõem /ai-chat (streaming SSE). Consumimos o stream agregando os deltas.
async function readSseToText(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") return out;
      try {
        const p = JSON.parse(json);
        const c = p.choices?.[0]?.delta?.content;
        if (c) out += c;
      } catch {/* partial */}
    }
  }
  return out;
}

async function tryWorkers(userPrompt: string, workers: AiWorker[], supabase: any): Promise<any | null> {
  for (const w of workers) {
    try {
      const r = await fetch(`${w.base_url}/functions/v1/ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userPrompt }],
          systemPrompt: SYSTEM_PROMPT,
          tenantName: "import",
          niche: "ecommerce",
        }),
      });
      if (r.status === 429 || r.status === 402 || r.status === 503) {
        if (!w.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", w.id);
        continue;
      }
      if (!r.ok || !r.body) continue;
      const text = await readSseToText(r.body);
      const parsed = parseJsonResponse(text);
      if (!parsed) continue;
      if (w.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", w.id);
      else await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
      return parsed;
    } catch (e) { console.error(`Worker ${w.id} fail`, e); continue; }
  }
  return null;
}

function normalizePrice(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const s = v.replace(/[^\d.,]/g, "");
  const norm = s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(/,/g, "");
  return Number(norm) || 0;
}

const decodeHtmlEntities = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

function findMetaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}

function findProductInJsonLd(html: string): any | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const search = (n: any): any | null => {
    if (!n) return null;
    const t = n["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return n;
    if (n["@graph"] && Array.isArray(n["@graph"])) {
      for (const x of n["@graph"]) { const p = search(x); if (p) return p; }
    }
    return null;
  };
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of arr) { const p = search(n); if (p) return p; }
    } catch { /* ignore */ }
  }
  return null;
}

function nativeExtractFromHtml(html: string): { name: string; price: number; image: string; description: string } {
  let name = "", price = 0, image = "", description = "";

  const product = findProductInJsonLd(html);
  if (product) {
    if (typeof product.name === "string") name = product.name.trim().slice(0, 200);
    if (typeof product.description === "string") description = product.description.trim().slice(0, 500);
    const offers = product.offers;
    if (offers) {
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const p = offer?.price ?? offer?.lowPrice ?? offer?.highPrice;
      if (p != null) price = normalizePrice(String(p));
    }
    const img = product.image;
    if (img) {
      if (typeof img === "string") image = img;
      else if (Array.isArray(img) && img.length) image = typeof img[0] === "string" ? img[0] : (img[0]?.url ?? "");
      else if (typeof img === "object") image = img.url ?? "";
    }
  }

  if (!name) {
    const t = findMetaContent(html, ["og:title", "twitter:title", "title"])
      ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    if (t) name = decodeHtmlEntities(t).trim().slice(0, 200);
  }
  if (!image) {
    const i = findMetaContent(html, ["og:image", "twitter:image", "image"]);
    if (i) image = i;
  }
  if (price === 0) {
    const p = findMetaContent(html, ["product:price:amount", "og:price:amount", "twitter:data1", "price"]);
    if (p) price = normalizePrice(p);
  }
  if (!description) {
    const d = findMetaContent(html, ["og:description", "twitter:description", "description"]);
    if (d) description = d.slice(0, 500);
  }

  return { name, price, image: image.trim(), description };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { url: rawUrl, useAi = false } = (await req.json()) as ImportRequest;
    if (!rawUrl || typeof rawUrl !== "string" || !/^https?:\/\//i.test(rawUrl)) {
      return new Response(JSON.stringify({ error: "URL inválida" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let finalUrl = rawUrl.trim();
    const host = (() => { try { return new URL(finalUrl).hostname.toLowerCase(); } catch { return ""; } })();
    const isShort = SHORT_LINK_HOSTS.some(s => host === s || host.endsWith("." + s));
    // Resolve sempre que: (a) for link curto, (b) tiver query gateway tipo ?go=,
    // (c) for path conhecido de gateway. Isso evita parar em páginas como
    // mercadolivre.com.br/gz/webdevice/config?go=URL_REAL (que tem preço/produto errado).
    const looksLikeGateway = !!extractGatewayTarget(finalUrl)
      || /\/(gz\/webdevice\/config|universal-link|deeplink|social\/eh)/i.test(finalUrl);
    if (isShort || looksLikeGateway) finalUrl = await resolveUrl(finalUrl);

    // Modo nativo (padrão): resolve URL + extrai dados via JSON-LD/meta tags. SEM IA.
    if (!useAi) {
      const html = await fetchHtml(finalUrl);
      const network = detectNetwork(finalUrl, html);
      const native = nativeExtractFromHtml(html);
      // Detecta páginas de bloqueio/erro/redirect comuns
      const genericNames = /^(mercado libre|mercado livre|amazon\.com\.br|shopee|aliexpress|magazine luiza|americanas|just a moment|attention required)\.?$/i;
      const looksBlocked =
        /n[ãa]o foi poss[íi]vel encontrar|page not found|enter the characters|robot check|access denied|just a moment|attention required/i.test(native.name + " " + native.description)
        || genericNames.test(native.name.trim())
        || (network === "shopee" && !native.name && !native.image)
        || (network === "amazon" && (!native.image || /n[ãa]o foi poss[íi]vel/i.test(native.name)));
      const got = (native.name !== "" && !genericNames.test(native.name.trim())) || native.price > 0 || native.image !== "";
      return new Response(JSON.stringify({
        affiliate_url: finalUrl, original_url: rawUrl, affiliate_network: network,
        name: looksBlocked ? "" : native.name,
        price: looksBlocked ? 0 : native.price,
        image: looksBlocked ? "" : native.image,
        category: "Geral",
        description: looksBlocked ? "" : native.description,
        ai_used: false,
        native_used: got && !looksBlocked,
        warning: looksBlocked
          ? `A loja (${network}) bloqueou a leitura automática. Preencha nome, preço e imagem manualmente.`
          : (got ? null : "Não foi possível extrair dados desta página. Preencha manualmente."),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Modo IA: busca HTML, extrai e tenta providers em ordem.
    const html = await fetchHtml(finalUrl);
    const network = detectNetwork(finalUrl, html);
    const structured = extractStructured(html);
    const rawSlice = structured.length < 1500 ? `\n\nRAW_HTML_HEAD:\n${html.slice(0, 12000)}` : "";
    const userPrompt = buildUserPrompt(finalUrl, network, structured, rawSlice);

    const supabase = getSupabaseAdmin();
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    let parsed = await tryWorkers(userPrompt, workers, supabase);
    let aiSource = "workers";
    if (!parsed) { parsed = await tryGoogle(userPrompt, keys, supabase); aiSource = "google"; }
    if (!parsed) { parsed = await tryLovable(userPrompt); aiSource = "lovable"; }
    if (!parsed) { parsed = await tryOpenRouter(userPrompt); aiSource = "openrouter"; }

    if (!parsed) {
      // Sem IA disponível — devolve só URL/rede pra usuário cadastrar manual
      return new Response(JSON.stringify({
        affiliate_url: finalUrl, original_url: rawUrl, affiliate_network: network,
        name: "", price: 0, image: "", category: "Geral", description: "",
        ai_used: false,
        warning: "Nenhuma IA disponível no momento. Preencha os campos manualmente.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      name: (parsed.name || "").toString().trim().slice(0, 200),
      price: normalizePrice(parsed.price),
      image: (parsed.image || "").toString().trim(),
      category: (parsed.category || "Geral").toString().trim(),
      description: (parsed.description || "").toString().trim().slice(0, 500),
      affiliate_network: network,
      affiliate_url: finalUrl,
      original_url: rawUrl,
      ai_used: true,
      ai_source: aiSource,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("import err", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
