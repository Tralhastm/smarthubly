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
function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function technicalFacts(description: string) {
  return description.replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(line => line.length >= 3 && line.length <= 90)
    .filter(line => /\b(ram|armazenamento|mem[oó]ria|c[aâ]mera|bateria|tela|display|processador|chip|android|5g|polegadas|mah|mp|gb|tb|hz)\b/i.test(line))
    .slice(0, 6);
}
async function createTechnicalBanner(client: any, tenantId: string, productName: string, description: string) {
  const facts = technicalFacts(description);
  const lines = facts.length ? facts : ['Consulte a descrição do produto para ver todos os detalhes técnicos.'];
  const lineMarkup = lines.map((line, index) => `<text x="70" y="${235 + index * 43}" class="fact">${escapeXml(line)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071b35"/><stop offset="1" stop-color="#1261a0"/></linearGradient></defs>
<rect width="1200" height="800" rx="36" fill="url(#bg)"/><circle cx="1050" cy="100" r="260" fill="#36bdf5" opacity=".14"/><circle cx="1120" cy="700" r="300" fill="#7dd3fc" opacity=".1"/>
<rect x="58" y="58" width="1084" height="684" rx="28" fill="#ffffff" opacity=".08" stroke="#ffffff" stroke-opacity=".22"/>
<text x="70" y="130" fill="#8bdcff" font-family="Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="3">ESPECIFICAÇÕES TÉCNICAS</text>
<text x="70" y="190" fill="#ffffff" font-family="Arial,sans-serif" font-size="42" font-weight="700">${escapeXml(productName).slice(0, 48)}</text>
${lineMarkup}<text x="70" y="690" fill="#c7eaff" font-family="Arial,sans-serif" font-size="20">Informações do cadastro do produto · Smarthubly</text></svg>`;
  const bytes = new TextEncoder().encode(svg);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const path = `${tenantId}/carousel-banner-${hash}.svg`;
  const { error } = await client.storage.from('product-images').upload(path, bytes, { contentType: 'image/svg+xml', upsert: true });
  if (error) return null;
  return `${client.storage.from('product-images').getPublicUrl(path).data.publicUrl}?src=carousel-generated-banner`;
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
async function curateVisually(productName: string, description: string, candidates: Array<{ url: string; source: string; kind?: string; reason: string }>) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (candidates.length <= 1) return [];
  try {
    const content: any[] = [{ type: "text", text: `Você é um curador visual extremamente rigoroso. Produto EXATO: \"${productName}\". Contexto técnico cadastrado: ${description.slice(0, 3000)}. Analise as opções e escolha no máximo 6 imagens. Uma imagem só pode ser aprovada se mostrar exatamente a marca, linha, modelo e capacidade do produto solicitado; modelo parecido, geração anterior/posterior, versão Pro/Ultra/Plus diferente ou imagem genérica deve ser REJEITADO. Não deduza identidade apenas pela aparência. Se não for possível confirmar o modelo, use keep:false. NÃO mantenha imagens repetidas por enquadramento ou composição, mesmo vindas de domínios diferentes. Classifique cada aprovada em um grupo único: cover, rear, side, detail, screen, accessories, colors, technical_card ou other. Priorize fotos reais do aparelho e fichas em português. Rejeite artes em inglês/espanhol, logos, anúncios de outro produto e qualquer imagem sem correspondência verificável. Responda SOMENTE JSON válido: [{\"index\":1,\"keep\":true,\"group\":\"cover\",\"language\":\"none\",\"exact_match\":true}].` }];
    const usable: number[] = [];
    const images = await Promise.all(candidates.map(candidate => imageAsBase64(candidate.url)));
    images.forEach((image, index) => {
      if (!image) return;
      usable.push(index);
      content.push({ type: "text", text: `OPÇÃO ${index + 1}${candidates[index].kind === "technical" ? " — ESPECIFICAÇÃO TÉCNICA" : ""}:` });
      content.push({ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.b64}` } });
    });
    // Sem pelo menos duas imagens analisáveis não há confirmação visual
    // suficiente para aprovar um modelo parecido. O chamador criará o banner
    // técnico determinístico em vez de arriscar uma foto errada.
    if (usable.length <= 1) return [];
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
    const selected: Array<{ url: string; source: string; kind?: string; reason: string }> = [];
    for (const decision of decisions) {
      const index = Number(decision.index || 0) - 1;
      if (!decision.keep || decision.exact_match === false || index < 0 || index >= candidates.length || selected.length >= 8) continue;
      const role = String((decision as any).group || (decision as any).role || "other");
      const language = String(decision.language || "none").toLowerCase();
      if (usedRoles.has(role) && role !== "other") continue;
      if (role === "technical_card" && language !== "pt-br" && language !== "none" && language !== "portuguese") continue;
      usedRoles.add(role);
      selected.push(candidates[index]);
    }
    const technical = candidates.find((candidate) => candidate.kind === "technical");
    if (technical && !selected.some((candidate) => candidate.url === technical.url)) {
      const replaceIndex = selected.findIndex((candidate) => candidate.kind !== "technical");
      if (selected.length < 6) selected.push(technical);
      else if (replaceIndex >= 0) selected[replaceIndex] = technical;
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
    const description = String(body.description || "").trim();
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
      `"${productName}" celular novo lacrado Brasil`,
      `"${productName}" especificações técnicas ficha técnica português Brasil`,
      `"${productName}" RAM armazenamento câmera bateria tela processador português`,
      `"${productName}" imagem especificações técnicas português Brasil`,
      `"${productName}" Mercado Livre Brasil novo`,
    ];
    const sourceGroups = await Promise.all(queries.map(searchImages));
    const sourceEntries = [...new Map(sourceGroups.flatMap((group, queryIndex) => group.map((source) => [normalizeSourceUrl(source), { source: normalizeSourceUrl(source), queryIndex }]))).values()];
    const sources = sourceEntries
      .filter((entry) => validUrl(entry.source))
      .sort((a, b) => (b.queryIndex === 2 ? 1 : 0) - (a.queryIndex === 2 ? 1 : 0) || sourceScore(b.source) - sourceScore(a.source))
      .slice(0, 60);
    const existing = new Set(existingUrls.map((url: string) => url.split("?")[0]));
    const candidates: Array<{ url: string; source: string; reason: string }> = [];
    const savedResults = await Promise.all(sources.map(async (entry) => ({ ...entry, saved: await persistImage(client, tenantId, entry.source) })));
    const hostCounts = new Map<string, number>();
    const sourceSignatures = new Set<string>();
    for (const { source, queryIndex, saved } of savedResults) {
      if (!saved || existing.has(saved.split("?")[0]) || candidates.some(candidate => candidate.url.split("?")[0] === saved.split("?")[0])) continue;
      const host = sourceHost(source);
      const signature = source.toLowerCase().replace(/[?#].*$/, '').replace(/\b(?:thumb|small|medium|large|zoom|1x|2x)\b/g, '').replace(/[^a-z0-9]+/g, '');
      const kind = queryIndex === 1 || queryIndex === 2 || /spec|ficha|technical|ram|camera|bateria|display|tela/i.test(source) ? "technical" : "photo";
      if ((hostCounts.get(host) || 0) >= 2 || sourceSignatures.has(signature)) continue;
      hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
      sourceSignatures.add(signature);
      candidates.push({ url: saved, source, kind, reason: "Imagem encontrada para o modelo pesquisado e aprovada no filtro de formato, duplicidade e legibilidade." });
      if (candidates.length >= 12) break;
    }
    let curated = await curateVisually(productName, description, candidates);
    // A arte informativa é deliberadamente determinística: usa somente os dados
    // já cadastrados e não uma geração livre de imagem do aparelho.
    if (!curated.some(candidate => candidate.kind === 'technical')) {
      const banner = await createTechnicalBanner(client, tenantId, productName, description);
      if (banner) curated = [...curated, { url: banner, source: 'Banner técnico gerado pelo cadastro', kind: 'technical', reason: 'Arte informativa em português criada com o nome e as especificações cadastradas.' }];
    }
    return new Response(JSON.stringify({ productName, existingUrls, candidates: curated, searched: sources.length, curation: curated.length < candidates.length ? "visual" : "automatic" }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
