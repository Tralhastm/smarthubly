import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
function decodeUrl(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}
function validUrl(value: string) {
  return /^https?:\/\//i.test(value) && value.length < 2000 && !/sprite|favicon|placeholder|1x1|pixel\.gif/i.test(value);
}
function extractBing(html: string, max: number) {
  const out = new Set<string>();
  const patterns = [
    /murl(?:&quot;|\\?"):\s*(?:&quot;|\\?")([^&quot;\\"]+?)(?:&quot;|\\?")/gi,
    /"murl"\s*:\s*"([^"]+)"/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.size < max) {
      const url = decodeUrl(m[1]);
      if (validUrl(url)) out.add(url);
    }
  }
  const generic = /https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?/gi;
  let m: RegExpExecArray | null;
  while ((m = generic.exec(html)) && out.size < max) {
    const url = decodeUrl(m[0]);
    if (validUrl(url) && !/bing\.com|gstatic\.com/i.test(url)) out.add(url);
  }
  return [...out];
}
async function searchImages(query: string, max = 10) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&safeSearch=Strict`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" } });
  if (!res.ok) return [];
  return extractBing(await res.text(), max);
}
function sniff(bytes: Uint8Array) {
  return bytes.length >= 12 && (
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
    (bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) ||
    (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
  );
}
async function fetchImage(url: string) {
  for (const headers of [
    { "User-Agent": UA, Referer: "https://www.google.com/", Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
    { "User-Agent": UA, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
  ]) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { headers, signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "";
      if ((!contentType.startsWith("image/") && !sniff(bytes)) || bytes.length < 5000) continue;
      const ext = contentType.includes("png") || (contentType === "" && bytes[0] === 0x89) ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const mime = contentType.startsWith("image/") ? contentType.split(";")[0] : `image/${ext}`;
      return { bytes, ext, mime };
    } catch { /* tenta sem Referer */ }
  }
  return null;
}
async function saveImage(client: any, tenantId: string, imageUrl: string) {
  const fetched = await fetchImage(imageUrl);
  if (!fetched) return null;
  const digest = await crypto.subtle.digest("SHA-256", fetched.bytes);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  const path = `${tenantId}/g-${hash}.${fetched.ext}`;
  const { error } = await client.storage.from("product-images").upload(path, fetched.bytes, { contentType: fetched.mime, upsert: true });
  if (error) return null;
  const { data } = client.storage.from("product-images").getPublicUrl(path);
  return `${data.publicUrl}?src=google`;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const body = await req.json();
    const query = String(body.query || "").trim();
    const tenantId = String(body.tenantId || "").trim();
    if (!query || !tenantId) return new Response(JSON.stringify({ error: "query_and_tenant_required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const urls = await searchImages(`${query} produto`, 12);
    if (!urls.length) return new Response(JSON.stringify({ error: "no_search_results", tried: 0 }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    const client = db();
    for (const url of urls) {
      const imageUrl = await saveImage(client, tenantId, url);
      if (imageUrl) return new Response(JSON.stringify({ imageUrl, source: "web", tried: urls.length }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "no_downloadable_image", tried: urls.length }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
