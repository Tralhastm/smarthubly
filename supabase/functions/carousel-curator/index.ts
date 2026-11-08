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
function validProductSource(value: string, productName: string) {
  if (!validUrl(value) || /(?:recondicionado|refurbished|renewed|usado|seminovo|open.?box|grade.?a|screenshot|captura|print|thumbnail|avatar|logo|sem[-_ ]?t[-_ ]?tul|sem[-_ ]?t[ií]tulo)/i.test(value)) return false;
  const source = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const product = productName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const variant of ['pro', 'plus', 'ultra', 'max', 'mini', 'fe', 'fusion', 'neo']) {
    if (new RegExp(`(?:^|[-_/])${variant}(?:[-_/.]|$)`, 'i').test(source) && !new RegExp(`\\b${variant}\\b`, 'i').test(product)) return false;
  }
  return true;
}
function sourceScore(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    let score = 0;
    if (host.endsWith('.com.br')) score += 5;
    if (host.includes('mlstatic.com') || host.includes('mercadolivre.com.br')) score += 4;
    if (host.includes('motorola.com.br') || host.includes('samsung.com') || host.includes('mi.com')) score += 3;
    if (host.endsWith('.com.ar') || host.endsWith('.com.mx') || host.endsWith('.cl')) score -= 5;
    return score;
  } catch { return 0; }
}
function sourceHost(value: string) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}
function extractBing(html: string, max: number) {
  const out = new Set<string>();
  for (const re of [
    /(?:"|&quot;)?murl(?:"|&quot;)?\s*:\s*(?:"|&quot;)(https?:\/\/.*?)(?:"|&quot;)/gi,
    /murl\\?"\s*:\s*\\?"(https?:\/\/.*?)(?:\\?"|&quot;)/gi,
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
function normalizeSourceUrl(value: string) {
  const decoded = decodeUrl(value);
  const embedded = decoded.match(/murl["']?\s*:\s*["'](https?:\/\/[^"']+)/i)?.[1];
  return (embedded || decoded).replace(/["'\\]+$/g, "");
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
async function imageAsBase64(url: string) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": UA } });
    if (!response.ok) return null;
    const mime = response.headers.get("content-type") || "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 850_000) bytes = bytes.slice(0, 850_000);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { mime, b64: btoa(binary) };
  } catch { return null; }
}
async function askGoogleVision(client: any, content: any[]) {
  const { data: keys } = await client.from("api_keys").select("id,api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", { ascending: true, nullsFirst: true }).limit(5);
  for (const key of keys || []) {
    try {
      const parts = content.map((item: any) => item.type === "text"
        ? { text: item.text }
        : { inline_data: { mime_type: String(item.image_url?.url || "").match(/^data:([^;]+);/)?.[1] || "image/jpeg", data: String(item.image_url?.url || "").split(",")[1] || "" } });
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key.api_key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }] }),
      });
      if (response.status === 429 || response.status === 403) {
        await client.from("api_keys").update({ is_exhausted: true }).eq("id", key.id);
        continue;
      }
      if (!response.ok) continue;
      await client.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
      const data = await response.json();
      return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
    } catch { continue; }
  }
  return null;
}
async function askWorkerVision(client: any, productName: string, content: any[]) {
  const { data: workers } = await client.from("ai_workers")
    .select("id,base_url,is_exhausted")
    .eq("worker_type", "chat")
    .eq("is_active", true)
    .eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(12);
  for (const worker of workers || []) {
    const url = worker.base_url.includes("/functions/") ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content }],
          systemPrompt: "Você é um curador visual multimodal. Responda somente JSON válido, sem markdown.",
          tenantName: "Carrossel IA",
          niche: `Catálogo de celulares; produto: ${productName}`,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        await client.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        continue;
      }
      if (!response.ok) continue;
      let text = "";
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw);
        text = String(parsed?.choices?.[0]?.message?.content || parsed?.content || parsed?.text || "");
      } catch {
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            text += String(parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content || "");
          } catch { /* ignora eventos SSE não JSON */ }
        }
      }
      if (text.trim()) {
        await client.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
        return text;
      }
    } catch {
      await client.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
    }
  }
  return null;
}
async function curateVisually(productName: string, candidates: Array<{ url: string; source: string; reason: string }>) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (candidates.length <= 1) return candidates;
  try {
    const content: any[] = [{ type: "text", text: `Você é um curador visual extremamente rigoroso de catálogo brasileiro. Produto EXATO solicitado: \"${productName}\". Analise cada imagem e escolha no máximo 6. Só aprove uma imagem se conseguir confirmar visualmente a marca, linha, modelo e capacidade exatos; modelo parecido, geração diferente, versão Pro/Plus/Ultra/Max/Mini diferente, aparelho usado ou recondicionado deve ser rejeitado. Não deduza identidade apenas pela aparência. Rejeite prints, telas de marketplace, logos, colagens e imagens promocionais sem o produto identificável. NÃO mantenha duas imagens com o mesmo enquadramento ou composição, mesmo de domínios diferentes. Use no máximo uma imagem por grupo: cover, rear, side, detail, screen, accessories, colors, technical_card, front_rear_render ou other. Para technical_card, prefira português e não aceite duas fichas equivalentes. Se não puder confirmar, use keep:false. Responda SOMENTE JSON válido: [{\"index\":1,\"keep\":true,\"group\":\"cover\",\"language\":\"none\",\"exact_match\":true}].` }];
    const usable: number[] = [];
    const images = await Promise.all(candidates.map(candidate => imageAsBase64(candidate.url)));
    images.forEach((image, index) => {
      if (!image) return;
      usable.push(index);
      content.push({ type: "text", text: `OPÇÃO ${index + 1}:` });
      content.push({ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.b64}` } });
    });
    if (usable.length <= 1) return candidates;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let text = await askWorkerVision(db(), productName, content) || "";
    if (!text && apiKey) {
      try {
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content }] }),
          signal: controller.signal,
        });
        if (response.ok) { const data = await response.json(); text = String(data?.choices?.[0]?.message?.content || ""); }
      } catch { /* fallback Google abaixo */ }
    }
    clearTimeout(timeout);
    if (!text) text = await askGoogleVision(db(), content) || "";
    if (!text) return [];
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const decisions = JSON.parse(match[0]) as Array<{ index?: number; keep?: boolean; role?: string; language?: string; exact_match?: boolean }>;
    const usedRoles = new Set<string>();
    const selected: Array<{ url: string; source: string; reason: string }> = [];
    for (const decision of decisions) {
      const index = Number(decision.index || 0) - 1;
      if (!decision.keep || decision.exact_match === false || index < 0 || index >= candidates.length || selected.length >= 6) continue;
      const role = String((decision as any).group || (decision as any).role || "other");
      const language = String(decision.language || "none").toLowerCase();
      if (usedRoles.has(role) && role !== "other") continue;
      if (role === "technical_card" && language !== "pt-br" && language !== "none" && language !== "portuguese") continue;
      usedRoles.add(role);
      selected.push(candidates[index]);
    }
    return selected;
  } catch (error) {
    console.warn("[carousel-vision] fallback heurístico:", error instanceof Error ? error.message : String(error));
    return [];
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
    const client = db();
    if (body.action === "cleanup") {
      const { data: files, error: listError } = await client.storage.from("product-images").list(tenantId, { limit: 1000 });
      if (listError) throw listError;
      const paths = (files || []).filter((file: { name?: string }) => file.name?.startsWith("carousel-")).map((file: { name: string }) => `${tenantId}/${file.name}`);
      if (paths.length) {
        const { error: removeError } = await client.storage.from("product-images").remove(paths);
        if (removeError) throw removeError;
      }
      return new Response(JSON.stringify({ cleaned: paths.length, tenantId }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const queries = [
      `site:mercadolivre.com.br "${productName}" novo`,
      `site:amazon.com.br "${productName}"`,
      `site:magazineluiza.com.br "${productName}"`,
      `site:shopee.com.br "${productName}"`,
      `site:casasbahia.com.br "${productName}"`,
      `"${productName}" celular novo lacrado`,
      `"${productName}" ficha técnica especificações português Brasil`,
    ];
    const sourceGroups = await Promise.all(queries.map(searchImages));
    const sources = [...new Set(sourceGroups.flat().map(normalizeSourceUrl))]
      .filter(source => validProductSource(source, productName))
      .sort((a, b) => sourceScore(b) - sourceScore(a))
      .slice(0, 36);
    const existing = new Set(existingUrls.map((url: string) => url.split("?")[0]));
    const candidates: Array<{ url: string; source: string; reason: string }> = [];
    const savedResults = await Promise.all(sources.map(async (source) => ({ source, saved: await persistImage(client, tenantId, source) })));
    const hostCounts = new Map<string, number>();
    const sourceSignatures = new Set<string>();
    for (const { source, saved } of savedResults) {
      if (!saved || existing.has(saved.split("?")[0]) || candidates.some(candidate => candidate.url.split("?")[0] === saved.split("?")[0])) continue;
      const host = sourceHost(source);
      const signature = source.toLowerCase().replace(/[?#].*$/, '').replace(/\b(?:thumb|small|medium|large|zoom|1x|2x)\b/g, '').replace(/[^a-z0-9]+/g, '');
      if ((hostCounts.get(host) || 0) >= 1 || sourceSignatures.has(signature)) continue;
      hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
      sourceSignatures.add(signature);
      candidates.push({ url: saved, source, reason: "Imagem encontrada para o modelo pesquisado e aprovada no filtro de formato, duplicidade e legibilidade." });
      if (candidates.length >= 10) break;
    }
    const curated = await curateVisually(productName, candidates);
    return new Response(JSON.stringify({ productName, existingUrls, candidates: curated, searched: sources.length, curation: curated.length < candidates.length ? "visual" : "automatic" }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
