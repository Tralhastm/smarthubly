import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function decodeUrl(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}
function validUrl(value: string) {
  return /^https?:\/\//i.test(value) && value.length < 2000 && !/sprite|favicon|placeholder|1x1|pixel\.gif/i.test(value);
}
function validProductSource(value: string) {
  return validUrl(value) && !/(?:recondicionado|refurbished|renewed|usado|seminovo|open.?box|grade.?a|screenshot|captura|print|thumbnail|avatar|logo)/i.test(value);
}
function extractBing(html: string, max: number) {
  const out = new Set<string>();
  for (const re of [
    /murl(?:&quot;|")\s*:\s*(?:&quot;|")((?:https?:\/\/).*?)(?:&quot;|")/gi,
    /["']murl["']\s*:\s*["'](https?:\/\/.*?)["']/gi,
    /murl(?:&quot;|\\?"):\s*(?:&quot;|\\?")([^&quot;\\"]+?)(?:&quot;|\\?")/gi,
    /"murl"\s*:\s*"([^"]+)"/gi,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) && out.size < max) {
      const url = decodeUrl(match[1]);
      if (validUrl(url)) out.add(url);
    }
  }
  const generic = /https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?/gi;
  let match: RegExpExecArray | null;
  while ((match = generic.exec(html)) && out.size < max) {
    const url = decodeUrl(match[0]);
    if (validUrl(url) && !/bing\.com|gstatic\.com/i.test(url)) out.add(url);
  }
  return [...out];
}
async function searchImages(query: string) {
  const response = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&safeSearch=Strict`, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
  });
  return response.ok ? extractBing(await response.text(), 18) : [];
}
function isImage(bytes: Uint8Array) {
  return bytes.length >= 12 && ((bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) || (bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50));
}
async function persistImage(client: any, tenantId: string, sourceUrl: string) {
  try {
    const response = await fetch(sourceUrl, { headers: { "User-Agent": UA, Referer: "https://www.google.com/" } });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 5000 || bytes.length > 12_000_000 || !isImage(bytes)) return null;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = `${tenantId}/carousel-${hash}.${ext}`;
    const { error } = await client.storage.from("product-images").upload(path, bytes, { contentType: `image/${ext}`, upsert: true });
    if (error) return null;
    return `${client.storage.from("product-images").getPublicUrl(path).data.publicUrl}?src=carousel-web`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || "").trim();
    const productName = String(body.productName || "").trim();
    const existingUrls = Array.isArray(body.existingUrls) ? body.existingUrls.filter((url: unknown) => typeof url === "string") : [];
    if (!tenantId || !productName) return new Response(JSON.stringify({ error: "tenant_and_product_required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const queries = [
      `"${productName}" celular novo lacrado`,
      `"${productName}" ficha técnica especificações`,
      `"${productName}" Mercado Livre novo`,
    ];
    const sources = [...new Set((await Promise.all(queries.map(searchImages))).flat())]
      .filter(validProductSource)
      .slice(0, 36);
    const existing = new Set(existingUrls.map((url: string) => url.split("?")[0]));
    const candidates: Array<{ url: string; source: string; reason: string }> = [];
    const client = db();
    for (const source of sources) {
      if (candidates.length >= 8) break;
      const saved = await persistImage(client, tenantId, source);
      if (!saved || existing.has(saved.split("?")[0])) continue;
      candidates.push({ url: saved, source, reason: "Imagem encontrada para o modelo pesquisado e aprovada no filtro de formato, duplicidade e legibilidade." });
    }
    return new Response(JSON.stringify({ productName, existingUrls, candidates, searched: sources.length, curation: "automatic" }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
