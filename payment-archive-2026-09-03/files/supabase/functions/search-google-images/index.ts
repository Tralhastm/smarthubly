// Busca imagens no Google Images via scraping (sem chave de API).
// Retorna até N URLs públicas. Se a flag `download=true`, baixa a primeira
// imagem boa, faz upload no bucket product-images e retorna a URL pública.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Extrai URLs reais de imagens do HTML do Bing Images.
// Bing embute as URLs originais como `murl&quot;:&quot;https://...&quot;` em data-m JSON.
function extractImageUrls(html: string, max: number): string[] {
  const out = new Set<string>();

  // Estratégia 1 (Bing): murl="https://..."
  const reMurl = /murl&quot;:&quot;([^&]+?)&quot;/g;
  let m: RegExpExecArray | null;
  while ((m = reMurl.exec(html)) !== null) {
    const url = m[1];
    if (isLikelyImage(url)) out.add(url);
    if (out.size >= max) return [...out];
  }

  // Estratégia 2 (DuckDuckGo): "image":"https://..."
  const reImg = /"image":"(https?:\/\/[^"]+?)"/g;
  while ((m = reImg.exec(html)) !== null) {
    const url = m[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (isLikelyImage(url)) out.add(url);
    if (out.size >= max) return [...out];
  }

  // Estratégia 3 (fallback): regex genérica de URLs de imagem
  const reGeneric = /https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?/gi;
  while ((m = reGeneric.exec(html)) !== null) {
    const url = m[0];
    if (isLikelyImage(url) && !url.includes("bing.com/") && !url.includes("gstatic.com")) {
      out.add(url);
    }
    if (out.size >= max) return [...out];
  }

  return [...out];
}

function isLikelyImage(url: string): boolean {
  if (!url || url.length > 2000) return false;
  if (!url.startsWith("http")) return false;
  if (/sprite|favicon|logo-google|placeholder|1x1|pixel\.gif/i.test(url)) return false;
  return true;
}

async function fromDuckDuckGo(query: string, max: number): Promise<string[]> {
  try {
    const tokRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=images&iax=images&ia=images`,
      { headers: { "User-Agent": UA } },
    );
    const tokHtml = await tokRes.text();
    const vqdMatch = tokHtml.match(/vqd=["']([^"']+)["']/) || tokHtml.match(/vqd=([\d-]+)&/);
    const vqd = vqdMatch?.[1];
    if (!vqd) return [];
    const jsonRes = await fetch(
      `https://duckduckgo.com/i.js?l=br-pt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&p=1`,
      { headers: { "User-Agent": UA, "Referer": "https://duckduckgo.com/" } },
    );
    if (!jsonRes.ok) return [];
    const data = await jsonRes.json();
    return (data.results || [])
      .map((r: any) => r.image)
      .filter((u: string) => isLikelyImage(u))
      .slice(0, max);
  } catch (e) {
    console.warn(`[search-images] DDG exception:`, (e as Error).message);
    return [];
  }
}

async function fromBing(query: string, max: number): Promise<string[]> {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&safeSearch=Strict`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) { console.warn(`[search-images] Bing ${res.status} for "${query}"`); return []; }
    return extractImageUrls(await res.text(), max);
  } catch (e) {
    console.warn(`[search-images] Bing exception:`, (e as Error).message);
    return [];
  }
}

async function fetchImageUrls(query: string, max: number): Promise<string[]> {
  // DuckDuckGo devolve resultados muito mais relevantes que o scraping do Bing
  const ddg = await fromDuckDuckGo(query, max);
  if (ddg.length >= Math.min(4, max)) return ddg;
  const bing = await fromBing(query, max);
  return [...new Set([...ddg, ...bing])].slice(0, max);
}


type FetchedImage = {
  url: string;          // url pública final no nosso bucket (com ?src=google)
  bytes: Uint8Array;    // conteúdo bruto pra ranking
  width: number;
  height: number;
  size: number;
  hash?: string;

};

// Rapidamente lê dimensões de PNG/JPEG/WebP a partir dos primeiros bytes.
function readImageSize(buf: Uint8Array): { width: number; height: number } | null {
  try {
    // PNG: 8-byte sig + IHDR (width@16, height@20, big-endian)
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
      const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
      return { width: w >>> 0, height: h >>> 0 };
    }
    // JPEG: varre marcadores SOFx
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = (buf[i + 2] << 8) | buf[i + 3];
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if ((marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)) {
          const h = (buf[i + 5] << 8) | buf[i + 6];
          const w = (buf[i + 7] << 8) | buf[i + 8];
          return { width: w, height: h };
        }
        i += 2 + len;
      }
    }
    // WebP VP8X: bytes 24..29 contém width-1 e height-1 (24 bits LE)
    if (buf.length >= 30 && buf[0] === 0x52 && buf[1] === 0x49 && buf[12] === 0x56 && buf[13] === 0x50) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
  } catch { /* ignore */ }
  return null;
}

// ===== Deduplicação: hash do conteúdo pra nunca repetir foto já usada na loja =====
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashFromUrl(url: string): string | null {
  const m = url.match(/\/g-([0-9a-f]{32})\.(?:jpg|png|webp)/i);
  return m ? m[1].toLowerCase() : null;
}

// Baixa (em paralelo) as imagens já usadas na loja e devolve o conjunto de hashes.
async function hashesOfExisting(urls: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  const toFetch: string[] = [];
  for (const u of urls.slice(0, 200)) {
    const h = hashFromUrl(u);
    if (h) set.add(h);
    else toFetch.push(u);
  }
  const limited = toFetch.slice(0, 60);
  await Promise.all(limited.map(async (u) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(u, { headers: { "User-Agent": UA }, signal: ctrl.signal })
        .finally(() => clearTimeout(t));
      if (!res.ok) return;
      const buf = new Uint8Array(await res.arrayBuffer());
      set.add((await sha256Hex(buf)).slice(0, 32));
    } catch { /* ignore */ }
  }));
  return set;
}

async function fetchAndUpload(
  supabase: any,
  imageUrl: string,
  tenantId: string,
  keepAny = false,
  excludeHashes?: Set<string>,
): Promise<FetchedImage | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": UA, "Referer": "https://www.google.com/" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!keepAny && buf.length < 5000) return null;
    const dim = readImageSize(buf);
    const width = dim?.width || 0;
    const height = dim?.height || 0;
    // descarta thumbnails minúsculos (não aplica quando o usuário escolheu a foto na mão)
    if (!keepAny && width && height && (width < 400 || height < 400)) return null;

    const hash = (await sha256Hex(buf)).slice(0, 32);
    // já existe foto idêntica na loja → descarta
    if (excludeHashes?.has(hash)) {
      console.log("[google-images] duplicada, descartada:", imageUrl);
      return null;
    }

    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    // nome determinístico pelo conteúdo: a mesma foto nunca vira dois arquivos
    const path = `${tenantId}/g-${hash}.${ext}`;
    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, buf, { contentType: ct, upsert: true });
    if (error) { console.warn("[google-images] upload error", error); return null; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    return { url: `${data.publicUrl}?src=google`, bytes: buf, width, height, size: buf.length, hash };
  } catch (e) {
    console.warn("[google-images] download failed", (e as Error).message);
    return null;
  }
}


// Ranking heurístico: prioriza alta resolução, formato próximo do quadrado, tamanho bom.
function scoreImage(img: FetchedImage): number {
  const pixels = (img.width || 800) * (img.height || 800);
  const ratio = img.width && img.height ? Math.min(img.width, img.height) / Math.max(img.width, img.height) : 0.5;
  // megapixels (cap 8MP) + bonus por aspect ratio próximo de 1:1 + tamanho bytes (proxy de qualidade)
  return (Math.min(pixels, 8_000_000) / 1_000_000) * 10
       + ratio * 5
       + Math.min(img.size, 800_000) / 200_000;
}

// Tenta extrair número da resposta da IA (1-based → 0-based)
function parsePick(txt: string, n: number): number {
  const m = (txt || "").toString().match(/\d+/);
  if (!m) return 0;
  const idx = parseInt(m[0], 10) - 1;
  return (idx >= 0 && idx < n) ? idx : 0;
}

const PICK_INSTRUCTION = (query: string, n: number) =>
  `Você é um curador visual de catálogo. Para o produto "${query}", escolha a MELHOR foto entre as opções numeradas (1 a ${n}). Critérios em ordem: 1) nítida (sem blur/pixelado); 2) fundo limpo ou contexto profissional; 3) o produto bem visível e centralizado; 4) cores naturais e iluminação boa; 5) sem watermarks/textos sobrepostos; 6) parece foto de e-commerce/catálogo, não meme/foto amadora. Responda APENAS com o número da escolhida (ex: "3"), nada mais.`;

// Tentativa 1: Lovable AI Gateway (multi-modal)
async function pickViaLovable(query: string, candidates: FetchedImage[]): Promise<number | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const content: any[] = [{ type: "text", text: PICK_INSTRUCTION(query, candidates.length) }];
    candidates.forEach((c, i) => {
      const mime = c.url.includes(".png") ? "image/png" : c.url.includes(".webp") ? "image/webp" : "image/jpeg";
      let bin = ""; for (let k = 0; k < c.bytes.length; k++) bin += String.fromCharCode(c.bytes[k]);
      content.push({ type: "text", text: `Opção ${i + 1}:` });
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${btoa(bin)}` } });
    });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content }] }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (res.status === 429 || res.status === 402 || !res.ok) {
      console.warn(`[ai-pick] Lovable falhou: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return parsePick(data.choices?.[0]?.message?.content || "", candidates.length);
  } catch (e) {
    console.warn("[ai-pick] Lovable exception:", (e as Error).message);
    return null;
  }
}

// Tentativa 2: Google AI direto (chaves do super admin) — também multi-modal
async function pickViaGoogle(supabase: any, query: string, candidates: FetchedImage[]): Promise<number | null> {
  const { data: keys } = await supabase
    .from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const allKeys = (keys && keys.length > 0) ? keys
    : (Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : []);
  if (allKeys.length === 0) return null;

  const parts: any[] = [{ text: PICK_INSTRUCTION(query, candidates.length) }];
  candidates.forEach((c, i) => {
    const mime = c.url.includes(".png") ? "image/png" : c.url.includes(".webp") ? "image/webp" : "image/jpeg";
    let bin = ""; for (let k = 0; k < c.bytes.length; k++) bin += String.fromCharCode(c.bytes[k]);
    parts.push({ text: `Opção ${i + 1}:` });
    parts.push({ inline_data: { mime_type: mime, data: btoa(bin) } });
  });

  for (const keyEntry of allKeys) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25_000);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts }] }),
          signal: ctrl.signal,
        }
      ).finally(() => clearTimeout(t));
      if (res.status === 429 || res.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!res.ok) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      const data = await res.json();
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return parsePick(txt, candidates.length);
    } catch (e) {
      console.warn("[ai-pick] Google exception:", (e as Error).message);
      continue;
    }
  }
  return null;
}

// Tentativa 3: Workers externos (chat) — só recebem texto, então mandamos descrição (resolução, ratio, tamanho)
async function pickViaWorkers(supabase: any, query: string, candidates: FetchedImage[]): Promise<number | null> {
  const { data: active } = await supabase
    .from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase
    .from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  const workers = [...(active || []), ...(exhausted || [])];
  if (workers.length === 0) return null;

  const description = candidates.map((c, i) =>
    `Opção ${i + 1}: ${c.width}x${c.height}px, ${(c.size / 1024).toFixed(0)}KB, ratio ${(Math.min(c.width, c.height) / Math.max(c.width, c.height)).toFixed(2)}`
  ).join("\n");
  const userMsg = `Produto: "${query}"\n\nCandidatos (não tenho como te mostrar a foto, escolha pelos metadados — prefira maior resolução, ratio próximo de 1.0, tamanho razoável que sugere boa qualidade):\n${description}\n\nResponda APENAS o número (1 a ${candidates.length}).`;

  for (const worker of workers) {
    try {
      const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMsg }],
          systemPrompt: "Você é um curador visual. Responda apenas com o número escolhido.",
          tenantName: "Curador",
          niche: "geral",
        }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (res.status === 429 || res.status === 402 || res.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        }
        continue;
      }
      if (!res.ok) continue;
      // Lê stream SSE inteiro
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "", fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (!j || j === "[DONE]") continue;
          try { const p = JSON.parse(j); const t2 = p.choices?.[0]?.delta?.content; if (t2) fullText += t2; } catch {}
        }
      }
      if (worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", worker.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
      }
      return parsePick(fullText, candidates.length);
    } catch (e) {
      console.warn(`[ai-pick] worker ${worker.id} exception:`, (e as Error).message);
      continue;
    }
  }
  return null;
}

// ===== Referências visuais (opcional) =====
// O usuário pode anexar fotos de referência (galeria ou link). Com elas:
// 1) a IA lê as referências e monta os termos de busca (mais preciso que texto solto)
// 2) a IA filtra os resultados, mantendo só o que combina com as referências
async function fetchRefBase64(url: string): Promise<{ mime: string; b64: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal })
      .finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    let buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 900_000) buf = buf.slice(0, 900_000);
    let bin = "";
    for (let k = 0; k < buf.length; k++) bin += String.fromCharCode(buf[k]);
    return { mime, b64: btoa(bin) };
  } catch {
    return null;
  }
}

async function askLovableVision(content: any[], timeoutMs = 30_000): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content }] }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) { console.warn("[refs] Lovable falhou", res.status); return null; }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.warn("[refs] Lovable exception:", (e as Error).message);
    return null;
  }
}

// Monta os termos de busca a partir das referências
async function queryFromRefs(refs: { mime: string; b64: string }[], hint: string, refOnly: boolean): Promise<string | null> {
  const content: any[] = [{
    type: "text",
    text: refOnly
      ? `Analise as fotos de referência abaixo e escreva APENAS os termos de busca (em português, máximo 8 palavras) que encontrariam fotos de produtos IGUAIS ou muito parecidos com essas referências. Sem aspas, sem explicação.`
      : `Analise as fotos de referência abaixo. O produto procurado é "${hint}". Escreva APENAS os termos de busca (em português, máximo 8 palavras) que encontrariam fotos parecidas com as referências para esse produto. Sem aspas, sem explicação.`,
  }];
  refs.forEach((r, i) => {
    content.push({ type: "text", text: `Referência ${i + 1}:` });
    content.push({ type: "image_url", image_url: { url: `data:${r.mime};base64,${r.b64}` } });
  });
  const txt = await askLovableVision(content);
  const clean = (txt || "").replace(/["\n\r]/g, " ").trim().slice(0, 120);
  return clean.length >= 3 ? clean : null;
}

// Filtra resultados mantendo só os parecidos com as referências
async function filterByRefs(
  refs: { mime: string; b64: string }[],
  urls: string[],
): Promise<string[]> {
  const pool = urls.slice(0, 12);
  const fetched: { url: string; img: { mime: string; b64: string } }[] = [];
  const got = await Promise.all(pool.map(async (u) => ({ url: u, img: await fetchRefBase64(u) })));
  for (const g of got) if (g.img) fetched.push({ url: g.url, img: g.img });
  if (fetched.length === 0) return urls;

  const content: any[] = [{
    type: "text",
    text: `Você compara fotos de produto. Primeiro verá REFERÊNCIAS do produto desejado, depois OPÇÕES numeradas. Responda APENAS com os números das opções que mostram o MESMO tipo de produto das referências (mesma categoria/aparência), separados por vírgula, da mais parecida para a menos parecida. Se nenhuma servir, responda "0".`,
  }];
  refs.forEach((r, i) => {
    content.push({ type: "text", text: `REFERÊNCIA ${i + 1}:` });
    content.push({ type: "image_url", image_url: { url: `data:${r.mime};base64,${r.b64}` } });
  });
  fetched.forEach((f, i) => {
    content.push({ type: "text", text: `OPÇÃO ${i + 1}:` });
    content.push({ type: "image_url", image_url: { url: `data:${f.img.mime};base64,${f.img.b64}` } });
  });
  const txt = await askLovableVision(content, 45_000);
  if (!txt) return fetched.map((f) => f.url);
  const nums = (txt.match(/\d+/g) || []).map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= fetched.length);
  const ordered = [...new Set(nums)].map((n) => fetched[n - 1].url);
  return ordered.length > 0 ? ordered : [];
}


// Cadeia: Lovable → Google (api_keys) → Workers → heurística (índice 0).
async function aiPickBest(supabase: any, query: string, candidates: FetchedImage[]): Promise<number> {
  if (candidates.length <= 1) return 0;
  const r1 = await pickViaLovable(query, candidates);
  if (r1 !== null) { console.log(`[ai-pick] Lovable escolheu ${r1 + 1}/${candidates.length}`); return r1; }
  console.log("[ai-pick] Lovable falhou, tentando Google keys...");
  const r2 = await pickViaGoogle(supabase, query, candidates);
  if (r2 !== null) { console.log(`[ai-pick] Google escolheu ${r2 + 1}/${candidates.length}`); return r2; }
  console.log("[ai-pick] Google falhou, tentando workers...");
  const r3 = await pickViaWorkers(supabase, query, candidates);
  if (r3 !== null) { console.log(`[ai-pick] Worker escolheu ${r3 + 1}/${candidates.length}`); return r3; }
  console.log("[ai-pick] todas IA falharam, usando heurística (top do ranking)");
  return 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const query: string = (body.query || "").toString().trim();
    const tenantId: string | undefined = body.tenantId;
    const max: number = Math.min(Math.max(Number(body.max) || 8, 1), 12);
    const download: boolean = !!body.download;
    // Curadoria: baixa top N candidatos, IA escolhe a melhor (resolução + nitidez + composição)
    const curate: boolean = body.curate !== false; // padrão ON quando download=true
    // Quantos candidatos baixar pra IA escolher
    const curationPool: number = Math.min(Math.max(Number(body.curationPool) || 4, 2), 6);
    // Se true, retorna o buffer base64 da imagem escolhida (pra geração com referência)
    const returnBuffer: boolean = !!body.returnBuffer;
    // Referências visuais opcionais (URLs de imagens). refOnly = buscar SÓ pelas referências.
    const refImages: string[] = Array.isArray(body.refImages)
      ? body.refImages.filter((u: unknown) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 20)
      : [];
    const refOnly: boolean = !!body.refOnly && refImages.length > 0;

    // Fotos que a loja JÁ usa — nunca devolver/salvar uma igual a essas
    const existingImages: string[] = Array.isArray(body.existingImages)
      ? body.existingImages.filter((u: unknown) => typeof u === "string" && /^https?:\/\//.test(u))
      : [];
    const excludeHashes = existingImages.length > 0 ? await hashesOfExisting(existingImages) : new Set<string>();

    // Modo "salvar exatamente esta imagem": o usuário já escolheu a foto na grade.
    // Nunca busca de novo — só baixa a URL informada e guarda no nosso bucket.
    const directUrl: string | undefined = typeof body.directUrl === "string" && /^https?:\/\//.test(body.directUrl)
      ? body.directUrl : undefined;
    if (directUrl) {
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "tenantId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const saved = await fetchAndUpload(admin(), directUrl, tenantId, true, excludeHashes);
      if (!saved) {
        // pode ser duplicada (hash já usado) ou falha de download — diferenciamos re-baixando sem filtro
        if (excludeHashes.size > 0) {
          const again = await fetchAndUpload(admin(), directUrl, tenantId, true);
          if (again && excludeHashes.has(again.hash || "")) {
            return new Response(JSON.stringify({ duplicate: true, error: "duplicate_image" }), {
              status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (again) {
            return new Response(JSON.stringify({ imageUrl: again.url, direct: true, width: again.width, height: again.height }), {
              status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
        return new Response(JSON.stringify({ error: "download_failed", imageUrl: directUrl }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ imageUrl: saved.url, direct: true, width: saved.width, height: saved.height }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    if (!query && !refOnly) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    // Carrega até 6 referências pra IA (o usuário pode anexar quantas quiser)
    let refs: { mime: string; b64: string }[] = [];
    if (refImages.length > 0) {
      const loaded = await Promise.all(refImages.slice(0, 6).map(fetchRefBase64));
      refs = loaded.filter((r): r is { mime: string; b64: string } => !!r);
    }

    let searchQuery = query;
    if (refs.length > 0) {
      const refQuery = await queryFromRefs(refs, query, refOnly);
      if (refQuery) searchQuery = refOnly ? refQuery : `${query} ${refQuery}`;
      else if (refOnly && !query) searchQuery = "";
    }
    if (!searchQuery) {
      return new Response(JSON.stringify({ error: "não consegui interpretar as referências" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const enhancedQuery = searchQuery.length < 25 ? `${searchQuery} produto` : searchQuery;
    const poolSize = excludeHashes.size > 0 ? Math.max(max + 6, 12) : max;
    let urls = await fetchImageUrls(enhancedQuery, refs.length > 0 ? Math.max(poolSize, 12) : poolSize);

    if (refs.length > 0 && urls.length > 0) {
      const filtered = await filterByRefs(refs, urls);
      urls = filtered.slice(0, Math.max(poolSize, max));
    }

    // Remove tudo que já é usado na loja (compara o conteúdo, não a URL)
    if (excludeHashes.size > 0 && urls.length > 0) {
      const checked = await Promise.all(urls.slice(0, 16).map(async (u) => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 10000);
          const res = await fetch(u, { headers: { "User-Agent": UA, "Referer": "https://www.google.com/" }, signal: ctrl.signal })
            .finally(() => clearTimeout(t));
          if (!res.ok) return u; // não deu pra checar, mantém
          const buf = new Uint8Array(await res.arrayBuffer());
          const h = (await sha256Hex(buf)).slice(0, 32);
          return excludeHashes.has(h) ? null : u;
        } catch { return u; }
      }));
      urls = checked.filter((u): u is string => !!u);
    }
    urls = urls.slice(0, max);


    if (!download && !returnBuffer) {
      return new Response(JSON.stringify({ urls }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tenantId && !returnBuffer) {
      return new Response(JSON.stringify({ error: "tenantId required when download=true" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = tenantId ? admin() : null;

    // Baixa em paralelo até obter `curationPool` candidatos válidos
    const candidates: FetchedImage[] = [];
    let i = 0;
    while (candidates.length < curationPool && i < urls.length) {
      const slice = urls.slice(i, i + curationPool);
      i += curationPool;
      const results = await Promise.all(
        slice.map((u) => fetchAndUpload(supabase, u, tenantId || "_tmp", false, excludeHashes)),
      );
      for (const r of results) if (r) candidates.push(r);
    }



    if (candidates.length === 0) {
      return new Response(JSON.stringify({ error: "no_usable_image", tried: urls.length }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pré-ranking heurístico (resolução, ratio, tamanho) — corta lixo antes da IA
    candidates.sort((a, b) => scoreImage(b) - scoreImage(a));
    const finalists = candidates.slice(0, Math.min(4, candidates.length));

    // IA escolhe (se curate ON e tem mais de 1)
    let pickIndex = 0;
    if (curate && finalists.length > 1) {
      pickIndex = await aiPickBest(supabase || admin(), query, finalists);
    }
    const chosen = finalists[pickIndex];

    // Apaga os descartados do storage pra não poluir o bucket
    if (supabase) {
      const discarded = candidates.filter((c) => c.url !== chosen.url)
        .map((c) => {
          const u = new URL(c.url.split("?")[0]);
          const m = "/object/public/product-images/";
          const idx = u.pathname.indexOf(m);
          return idx >= 0 ? decodeURIComponent(u.pathname.slice(idx + m.length)) : null;
        })
        .filter((x): x is string => !!x);
      if (discarded.length > 0) {
        supabase.storage.from("product-images").remove(discarded).catch(() => {});
      }
    }

    const responsePayload: any = {
      imageUrl: chosen.url,
      candidates: candidates.length,
      curated: curate && finalists.length > 1,
      width: chosen.width,
      height: chosen.height,
    };
    if (returnBuffer) {
      // base64 pequeno (até ~500KB) pra ser usado como referência visual no prompt do Nano Banana
      const max = 500_000;
      const slice = chosen.bytes.length > max ? chosen.bytes.slice(0, max) : chosen.bytes;
      let bin = "";
      for (let k = 0; k < slice.length; k++) bin += String.fromCharCode(slice[k]);
      responsePayload.imageBase64 = btoa(bin);
      responsePayload.mimeType = chosen.url.includes(".png") ? "image/png" : chosen.url.includes(".webp") ? "image/webp" : "image/jpeg";
    }
    return new Response(JSON.stringify(responsePayload), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
