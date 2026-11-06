import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36";
const MAX_SEARCH_RESULTS = 32;
const MAX_EXISTING_VISION_IMAGES = 8;
const MAX_VISION_IMAGES = 12;
const MAX_IMAGE_BYTES = 700_000;
const MAX_STORED_IMAGE_BYTES = 8_000_000;
const TOKEN_TTL_SECONDS = 60 * 60;
type SourceKind = "web" | "mercadolivre" | "generated";
type CarouselRole = "cover" | "front" | "rear" | "side" | "detail" | "screen" | "colors" | "technical_card" | "accessories" | "other";
type SearchResult = { title: string; pageUrl: string; imageUrl: string; description: string };
type SearchEntry = SearchResult & { sourceKind: SourceKind; queryIndex: number };
type ImageCandidate = {
  url: string;
  sourceKind: SourceKind;
  kind: "photo" | "technical";
  reason: string;
  role?: CarouselRole;
  topic?: string;
  bytes?: Uint8Array;
  mime?: string;
  hash?: string;
  token?: string;
};
type CurationResult = { candidates: ImageCandidate[]; approvedExistingUrls: string[]; approvedExistingTechnicalCard: boolean };
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#x22;/gi, '"')
    .replace(/&#39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function decodeUrl(value: string) {
  return decodeHtml(value).replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}
function isPrivateIp(host: string) {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:") || value.startsWith("::ffff:127.")) return true;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function validExternalUrl(value: string) {
  if (!value || value.length > 2000 || /sprite|favicon|placeholder|1x1|pixel\.gif/i.test(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) return false;
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || isPrivateIp(host)) return false;
    if (url.port && url.port !== "80" && url.port !== "443") return false;
    return true;
  } catch { return false; }
}
function sourceHost(value: string) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}
function isMercadoLivrePage(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br");
  } catch { return false; }
}
function stableUrlKey(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return value.trim(); }
}
function normalizeText(value: string) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function productIdentityTokens(productName: string) {
  const cleaned = normalizeText(productName)
    .replace(/\b\d+\s*\/\s*\d+(?:\s*\+\s*\d+)?\s*(?:gb|tb)\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mah|mp|hz)\b/g, " ")
    .replace(/\b(?:5g|4g|nfc|wifi|wi-fi|bluetooth|dual.?sim|ram|rom|memoria|armazenamento|storage|novo|lacrado|original|global|versao|celular|smartphone|telefone|mobile|phone|com|sem|de|da|do|para|em|preto|branco|azul|verde|violeta|roxo|laranja|titaneo|titanium)\b/g, " ");
  const tokens = cleaned.match(/[a-z0-9]+/g) || [];
  return [...new Set(tokens.filter((token) => token.length > 1))];
}
function titleMatchesProduct(productName: string, result: SearchResult) {
  const identity = productIdentityTokens(productName);
  if (identity.length < 2 || !result.title.trim()) return false;
  const metadata = normalizeText(`${result.title} ${result.pageUrl}`).replace(/[^a-z0-9]+/g, " ");
  return identity.every((token) => new RegExp(`(?:^| )${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(metadata));
}
function sourceScore(value: string) {
  const host = sourceHost(value);
  let score = 0;
  if (host.includes("mlstatic.com") || host.includes("mercadolivre.com.br")) score += 8;
  if (/samsung\.com|apple\.com|motorola\.com|mi\.com|xiaomi\.com|realme\.com/i.test(host)) score += 7;
  if (host.endsWith(".com.br")) score += 2;
  if (host.endsWith(".com.ar") || host.endsWith(".com.mx") || host.endsWith(".cl")) score -= 4;
  return score;
}
function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function technicalFacts(description: string) {
  const technicalTerm = /\b(ram|rom|armazenamento|mem[oó]ria|c[aâ]mera|bateria|tela|display|processador|chip|android|5g|polegadas|mah|mp|gb|tb|hz|resist[eê]ncia|autonomia|carregamento)\b/i;
  const portugueseTerm = /\b(de|com|para|em|tela|c[aâ]mera|bateria|mem[oó]ria|armazenamento|processador|resist[eê]ncia|autonomia|carregamento|polegadas|cor|at[eé]|durabilidade|resolu[cç][aã]o)\b/i;
  const foreignPhrase = /\b(up to|battery|screen|camera|processor|storage|memory|display|waterproof|fast charging|pantalla|cámara|batería|procesador|almacenamiento|hasta|resistencia al agua)\b/i;
  return String(description || "").replace(/\r\n?/g, "\n").split(/[\n;•]+/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((line) => line.length >= 4 && line.length <= 110)
    .filter((line) => technicalTerm.test(line) && portugueseTerm.test(line) && !foreignPhrase.test(line))
    .slice(0, 6);
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}
function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function dataUrl(bytes: Uint8Array, mime: string) {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
function createTechnicalBanner(productName: string, description: string): ImageCandidate | null {
  const facts = technicalFacts(description);
  if (facts.length < 2) return null;
  const boxes = facts.map((line, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 64 + col * 536;
    const y = 270 + row * 135;
    return `<rect x="${x}" y="${y}" width="492" height="104" rx="18" fill="#f7fafc" stroke="#dce8ed"/><circle cx="${x + 34}" cy="${y + 36}" r="8" fill="#14b8a6"/><text x="${x + 58}" y="${y + 46}" class="fact">${escapeXml(line)}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" rx="34" fill="#ffffff"/><rect width="1200" height="225" rx="34" fill="#0f2638"/><rect y="190" width="1200" height="35" fill="#0f2638"/><text x="64" y="74" fill="#48d6c4" font-family="Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="2">INFORMAÇÕES DO PRODUTO</text><text x="64" y="145" fill="#ffffff" font-family="Arial,sans-serif" font-size="40" font-weight="700">${escapeXml(productName).slice(0, 48)}</text><text x="64" y="190" fill="#d2e5eb" font-family="Arial,sans-serif" font-size="20">Dados extraídos da descrição cadastrada</text><style>.fact{font:600 22px Arial,sans-serif;fill:#102a3b}</style>${boxes}<text x="64" y="748" fill="#607d8b" font-family="Arial,sans-serif" font-size="17">Informações em português conforme cadastro do produto</text></svg>`;
  const bytes = new TextEncoder().encode(svg);
  return { url: dataUrl(bytes, "image/svg+xml"), sourceKind: "generated", kind: "technical", reason: "Banner em português com especificações copiadas da descrição cadastrada." };
}
function sha256Hex(bytes: Uint8Array) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}
function detectImageMime(bytes: Uint8Array, declared: string | null) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)).startsWith("GIF8")) return "image/gif";
  const mime = (declared || "").split(";")[0].trim().toLowerCase();
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime) ? mime : null;
}
async function downloadExternalImage(sourceUrl: string, maxBytes = MAX_IMAGE_BYTES) {
  try {
    let currentUrl = sourceUrl;
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (!validExternalUrl(currentUrl)) return null;
      const response = await fetch(currentUrl, {
        headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", Referer: "https://www.bing.com/" },
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || attempt === 3) return null;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (!response.ok) return null;
      const declared = response.headers.get("content-type");
      if (declared && !declared.toLowerCase().startsWith("image/")) return null;
      const size = Number(response.headers.get("content-length") || 0);
      if (size > maxBytes) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 5_000 || bytes.length > maxBytes) return null;
      const mime = detectImageMime(bytes, declared);
      if (!mime) return null;
      return { bytes, mime, hash: await sha256Hex(bytes) };
    }
  } catch { return null; }
  return null;
}
function extractBing(html: string, max: number): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const itemPattern = /<a[^>]*class="[^"]*\biusc\b[^"]*"[^>]*\bm="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(html)) && out.length < max) {
    try {
      const item = JSON.parse(decodeHtml(match[1]));
      const imageUrl = decodeUrl(String(item.murl || ""));
      const pageUrl = decodeUrl(String(item.purl || ""));
      if (!validExternalUrl(imageUrl) || !validExternalUrl(pageUrl)) continue;
      const key = stableUrlKey(imageUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: String(item.t || "").slice(0, 400),
        pageUrl,
        imageUrl,
        description: String(item.desc || "").slice(0, 700),
      });
    } catch { /* ignora item Bing malformado */ }
  }
  return out;
}
async function searchImages(query: string) {
  try {
    const response = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&safeSearch=Strict`, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? extractBing(await response.text(), 14) : [];
  } catch { return []; }
}
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
function rolePriority(role?: CarouselRole) {
  const order: Record<CarouselRole, number> = { cover: 0, front: 1, rear: 2, side: 3, detail: 4, screen: 5, colors: 6, technical_card: 7, accessories: 8, other: 9 };
  return order[role || "other"] ?? 9;
}
function normalizeLanguage(value: unknown) {
  return normalizeText(String(value || "")).replace(/[^a-z-]/g, "");
}
function parseJsonArray(text: string) {
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first < 0 || last < first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
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
        signal: AbortSignal.timeout(45_000),
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
          systemPrompt: "Você é um verificador multimodal conservador. Responda somente JSON válido, sem markdown.",
          tenantName: "Carrossel IA",
          niche: `Catálogo de produtos; produto exato: ${productName}`,
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
async function curateVisually(productName: string, description: string, candidates: ImageCandidate[], existingImages: ImageCandidate[]): Promise<CurationResult> {
  if (!candidates.length && !existingImages.length) return { candidates: [], approvedExistingUrls: [], approvedExistingTechnicalCard: false };
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  try {
    const identity = productIdentityTokens(productName).join(" ");
    const existingForVision = existingImages.slice(0, MAX_EXISTING_VISION_IMAGES);
    const candidatesForVision = candidates.slice(0, MAX_VISION_IMAGES);
    const content: any[] = [{ type: "text", text: `Tarefa: auditoria visual conservadora para catálogo. Produto solicitado, exato: "${productName}". Tokens de identidade obrigatórios: ${identity}. Descrição cadastrada (única fonte permitida para validar especificações): ${description.slice(0, 3000)}. Avalie imagens EXISTENTES e CANDIDATAS separadamente. Imagens existentes podem conter erros; não presuma que estão certas.

REGRAS INEGOCIÁVEIS:
1) Só aprove produto da mesma marca, linha, geração e variante exata. Não aceite Plus no lugar de Ultra, Pro no lugar de padrão, Max no lugar de Pro, outra geração ou outro modelo parecido. Se o título/página não prova o modelo exato, rejeite.
2) A imagem precisa ser nitidamente relacionada ao produto identificado no título e na página de origem fornecidos junto dela. Não conclua modelo apenas por ser parecido.
3) Fotos sem texto devem mostrar o produto exato; uma variante de memória/capacidade diferente não pode ser inferida como igual se houver diferença visível ou escrita.
4) Qualquer texto legível dentro de QUALQUER imagem deve estar em português do Brasil. Foto sem palavras: language="none". Texto em inglês, espanhol ou outro idioma: rejeite.
5) Banner informativo só pode ser aprovado se estiver em português e cada afirmação técnica for confirmada literalmente pela descrição cadastrada acima. Não traduza, complete lacunas nem aceite número/especificação não confirmado.
6) Remova imagens iguais ou quase iguais, inclusive imagens candidatas que repitam uma imagem existente. Use duplicate_of com índice positivo quando houver duplicata; use null somente se a imagem for única.
7) Priorize fotos limpas do produto (frente, traseira, lateral, detalhe, cores) e depois até 3 banners informativos exclusivos, todos coerentes. Não force a quantidade: na dúvida, rejeite.

Responda SOMENTE JSON válido, um objeto para cada imagem. Campos obrigatórios: source (existing ou candidate), index (número da imagem dentro da sua categoria), keep (booleano), exact_match (true somente se houver confirmação exata), group (cover|front|rear|side|detail|screen|colors|technical_card|accessories|other), language (pt-BR quando houver qualquer texto em português; none somente se não houver texto legível), specs_match (true somente se TODAS as afirmações do banner forem confirmadas na descrição), topic (ex.: câmera, tela, bateria, processador, memória, resistência), duplicate_of (índice positivo ou null obrigatório; null somente se for única). Para as imagens existentes, mantenha-as aprovadas somente se passarem por todas as mesmas regras. Exemplo: [{"source":"candidate","index":1,"keep":true,"exact_match":true,"group":"cover","language":"none","specs_match":true,"topic":"","duplicate_of":null}].` }];
    existingForVision.forEach((image, index) => {
      content.push({ type: "text", text: `IMAGEM EXISTENTE ${index + 1}: item já presente na galeria; valide modelo, texto e duplicação, não presuma que está correta.` });
      content.push({ type: "image_url", image_url: { url: dataUrl(image.bytes!, image.mime!) } });
    });
    candidatesForVision.forEach((candidate, index) => {
      const data = candidate.bytes && candidate.mime ? dataUrl(candidate.bytes, candidate.mime) : candidate.url;
      content.push({ type: "text", text: `IMAGEM CANDIDATA ${index + 1} · fonte=${candidate.sourceKind === "mercadolivre" ? "Mercado Livre" : "web"} · título e página de origem: ${candidate.reason}` });
      content.push({ type: "image_url", image_url: { url: data } });
    });
    let text = await askWorkerVision(db(), productName, content) || "";
    if (!text && apiKey) {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content }] }),
        signal: AbortSignal.timeout(45_000),
      });
      if (response.ok) {
        const data = await response.json();
        text = String(data?.choices?.[0]?.message?.content || "");
      }
    }
    if (!text) text = await askGoogleVision(db(), content) || "";
    const decisions = parseJsonArray(text);
    if (!Array.isArray(decisions)) return { candidates: [], approvedExistingUrls: [], approvedExistingTechnicalCard: false };
    const allowedRoles = new Set<CarouselRole>(["cover", "front", "rear", "side", "detail", "screen", "colors", "technical_card", "accessories", "other"]);
    const roleLimits: Record<CarouselRole, number> = { cover: 1, front: 1, rear: 1, side: 1, detail: 2, screen: 1, colors: 1, technical_card: 3, accessories: 1, other: 1 };
    const counts = new Map<CarouselRole, number>();
    const topics = new Set<string>();
    const accepted: Array<{ candidate: ImageCandidate; role: CarouselRole; index: number }> = [];
    const approvedExisting = new Set<string>();
    let approvedExistingTechnicalCard = false;
    const seenIndex = new Set<string>();
    for (const decision of decisions) {
      const source = String(decision?.source || "").toLowerCase();
      if (source !== "existing" && source !== "candidate") continue;
      const index = Number(decision?.index || 0) - 1;
      const sourceImages = source === "existing" ? existingForVision : candidatesForVision;
      const decisionKey = `${source}:${index}`;
      if (!Number.isInteger(index) || index < 0 || index >= sourceImages.length || seenIndex.has(decisionKey)) continue;
      seenIndex.add(decisionKey);
      if (decision?.keep !== true || decision?.exact_match !== true) continue;
      if (typeof decision?.group !== "string" || !Object.prototype.hasOwnProperty.call(decision, "duplicate_of") || decision.duplicate_of !== null) continue;
      const roleValue = String(decision.group).toLowerCase() as CarouselRole;
      if (!allowedRoles.has(roleValue)) continue;
      const language = normalizeLanguage(decision?.language);
      if (!(language === "none" || language === "pt-br" || language === "pt" || language === "portuguese")) continue;
      if (decision?.unique_visual === false) continue;
      if (roleValue === "technical_card") {
        if (!(language === "pt-br" || language === "pt" || language === "portuguese")) continue;
        if (decision?.specs_match !== true) continue;
      }
      if ((counts.get(roleValue) || 0) >= roleLimits[roleValue]) continue;
      const topic = normalizeText(String(decision?.topic || "")).trim();
      if (roleValue === "technical_card" && topic && topics.has(topic)) continue;
      const candidate = sourceImages[index];
      if (roleValue === "accessories" && !/acessor|kit|bundle|combo/i.test(productName)) continue;
      counts.set(roleValue, (counts.get(roleValue) || 0) + 1);
      if (roleValue === "technical_card" && topic) topics.add(topic);
      if (source === "existing") {
        approvedExisting.add(candidate.url);
        if (roleValue === "technical_card") approvedExistingTechnicalCard = true;
        continue;
      }
      if (accepted.length >= 8) continue;
      accepted.push({
        candidate: {
          ...candidate,
          kind: roleValue === "technical_card" ? "technical" : "photo",
          role: roleValue,
          topic,
          reason: roleValue === "technical_card"
            ? `Banner em português conferido com a descrição do produto${topic ? ` · ${topic}` : ""}.`
            : `Foto do modelo exato conferida · ${roleValue}.`,
        },
        role: roleValue,
        index,
      });
    }
    accepted.sort((a, b) => rolePriority(a.role) - rolePriority(b.role) || a.index - b.index);
    return {
      candidates: accepted.map((entry) => entry.candidate),
      approvedExistingUrls: existingForVision.filter((image) => approvedExisting.has(image.url)).map((image) => image.url),
      approvedExistingTechnicalCard,
    };
  } catch (error) {
    console.warn("[carousel-vision] nenhuma imagem aprovada pela auditoria:", error instanceof Error ? error.message : String(error));
    return { candidates: [], approvedExistingUrls: [], approvedExistingTechnicalCard: false };
  }
}
function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hmacKey() {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("service_role_key_unavailable");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function candidatePayload(tenantId: string, productName: string, runId: string, candidate: { url: string; kind: string; sourceKind: string }, expires: number) {
  return `${tenantId}\n${productName}\n${runId}\n${candidate.kind}\n${candidate.sourceKind}\n${expires}\n${candidate.url}`;
}
async function signCandidate(tenantId: string, productName: string, runId: string, candidate: ImageCandidate) {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const key = await hmacKey();
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(candidatePayload(tenantId, productName, runId, candidate))));
  return `${expires}.${bytesToBase64Url(mac)}`;
}
async function verifyCandidateToken(tenantId: string, productName: string, runId: string, candidate: any) {
  try {
    if (typeof candidate?.url !== "string" || candidate.url.length > 1_000_000 || typeof candidate?.token !== "string") return false;
    const [expiresText, signatureText] = candidate.token.split(".");
    const expires = Number(expiresText);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expires) || expires < now || expires > now + TOKEN_TTL_SECONDS + 60 || !signatureText) return false;
    const normalized = { url: candidate.url, kind: String(candidate.kind || ""), sourceKind: String(candidate.sourceKind || "") };
    if (!["photo", "technical"].includes(normalized.kind) || !["web", "mercadolivre", "generated"].includes(normalized.sourceKind)) return false;
    const signature = base64ToBytes(signatureText.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signatureText.length % 4) % 4));
    return await crypto.subtle.verify("HMAC", await hmacKey(), signature, new TextEncoder().encode(candidatePayload(tenantId, productName, runId, normalized, expires)));
  } catch { return false; }
}
async function materializeCandidate(client: any, tenantId: string, runId: string, candidate: any) {
  let bytes: Uint8Array;
  let mime: string;
  if (candidate.sourceKind === "generated") {
    const match = String(candidate.url).match(/^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error("generated_banner_invalid");
    bytes = base64ToBytes(match[1]);
    if (bytes.length > 200_000) throw new Error("generated_banner_too_large");
    const svg = new TextDecoder().decode(bytes).trim();
    if (!/^<svg\b/i.test(svg) || /<script\b|onload\s*=|javascript:/i.test(svg)) throw new Error("generated_banner_unsafe");
    mime = "image/svg+xml";
  } else {
    if (!validExternalUrl(candidate.url)) throw new Error("image_source_invalid");
    const image = await downloadExternalImage(candidate.url, MAX_STORED_IMAGE_BYTES);
    if (!image) throw new Error("image_unavailable_or_invalid");
    bytes = image.bytes;
    mime = image.mime;
  }
  const hash = (await sha256Hex(bytes)).slice(0, 32);
  const ext = mime === "image/svg+xml" ? "svg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  const sourceSuffix = candidate.sourceKind === "mercadolivre" ? "ml" : candidate.sourceKind === "generated" ? "generated" : "web";
  const path = `${tenantId}/carousel-${runId}-${hash}.${ext}`;
  const { error } = await client.storage.from("product-images").upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`storage_upload_failed: ${error.message}`);
  const storedUrl = `${client.storage.from("product-images").getPublicUrl(path).data.publicUrl}?src=carousel-${sourceSuffix}`;
  return { sourceUrl: candidate.url, url: storedUrl, kind: candidate.kind, sourceKind: candidate.sourceKind };
}
function validSegment(value: string) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || "").trim();
    const productName = String(body.productName || "").trim();
    const description = String(body.description || "").trim();
    const runId = String(body.runId || "").trim();
    if (!tenantId || !productName) return jsonResponse({ error: "tenant_and_product_required" }, 400);
    if (!validSegment(tenantId)) return jsonResponse({ error: "tenant_id_invalid" }, 400);
    const client = db();

    if (body.action === "persist_selected") {
      if (!validSegment(runId)) return jsonResponse({ error: "run_id_invalid" }, 400);
      const selectedCandidates = Array.isArray(body.selectedCandidates) ? body.selectedCandidates : [];
      if (!selectedCandidates.length || selectedCandidates.length > 10) return jsonResponse({ error: "selected_candidates_must_be_1_to_10" }, 400);
      const unique = [...new Map(selectedCandidates.map((candidate: any) => [String(candidate?.url || ""), candidate])).values()];
      for (const candidate of unique) {
        if (!await verifyCandidateToken(tenantId, productName, runId, candidate)) return jsonResponse({ error: "candidate_signature_invalid_or_expired" }, 403);
      }
      const saved = [];
      for (const candidate of unique) saved.push(await materializeCandidate(client, tenantId, runId, candidate));
      return jsonResponse({ saved, runId });
    }

    if (body.action === "cleanup") {
      const { data: files, error: listError } = await client.storage.from("product-images").list(tenantId, { limit: 1000 });
      if (listError) throw listError;
      const paths = (files || []).filter((file: { name?: string }) => file.name?.startsWith("carousel-")).map((file: { name: string }) => `${tenantId}/${file.name}`);
      if (paths.length) {
        const { error: removeError } = await client.storage.from("product-images").remove(paths);
        if (removeError) throw removeError;
      }
      return jsonResponse({ cleaned: paths.length, tenantId });
    }

    const existingUrls = Array.isArray(body.existingUrls) ? body.existingUrls.filter((url: unknown) => typeof url === "string") as string[] : [];
    const previewRunId = validSegment(runId) ? runId : crypto.randomUUID();
    const queries: Array<{ query: string; sourceKind: SourceKind }> = [
      { query: `"${productName}" imagem oficial produto frente costas`, sourceKind: "web" },
      { query: `"${productName}" ficha técnica recursos em português`, sourceKind: "web" },
      { query: `site:mercadolivre.com.br "${productName}"`, sourceKind: "mercadolivre" },
      { query: `site:mercadolivre.com.br "${productName}" ficha técnica`, sourceKind: "mercadolivre" },
    ];
    const groups = await Promise.all(queries.map((item) => searchImages(item.query)));
    const sourceMap = new Map<string, SearchEntry>();
    groups.forEach((results, queryIndex) => {
      const requestedSourceKind = queries[queryIndex].sourceKind;
      for (const result of results) {
        const isMlPage = isMercadoLivrePage(result.pageUrl);
        if (requestedSourceKind === "mercadolivre" && !isMlPage) continue;
        if (!titleMatchesProduct(productName, result)) continue;
        if (!validExternalUrl(result.imageUrl)) continue;
        const key = stableUrlKey(result.imageUrl);
        if (!sourceMap.has(key)) sourceMap.set(key, { ...result, sourceKind: isMlPage ? "mercadolivre" : "web", queryIndex });
      }
    });
    const existingKeys = new Set(existingUrls.map(stableUrlKey));
    const entries = [...sourceMap.values()]
      .filter((entry) => !existingKeys.has(stableUrlKey(entry.imageUrl)))
      .sort((a, b) => a.queryIndex - b.queryIndex || sourceScore(b.pageUrl) - sourceScore(a.pageUrl))
      .slice(0, MAX_SEARCH_RESULTS);
    const existingReviewUrls = [...new Map(existingUrls.filter(validExternalUrl).map((url) => [stableUrlKey(url), url])).values()].slice(0, MAX_EXISTING_VISION_IMAGES);
    const [downloaded, existingDownloaded] = await Promise.all([
      mapLimit(entries, 5, async (entry) => {
        const image = await downloadExternalImage(entry.imageUrl, MAX_IMAGE_BYTES);
        return image ? { entry, ...image } : null;
      }),
      mapLimit(existingReviewUrls, 4, async (url) => downloadExternalImage(url, MAX_IMAGE_BYTES)),
    ]);
    const seenHashes = new Set<string>();
    const existingHashes = new Set<string>();
    for (const url of existingUrls) {
      const match = url.match(/carousel-(?:.*-)?([a-f0-9]{32})\.(?:jpg|jpeg|png|webp|gif|svg)/i);
      if (match) existingHashes.add(match[1].toLowerCase());
    }
    const existingReferences: ImageCandidate[] = [];
    const seenExistingHashes = new Set<string>();
    for (let index = 0; index < existingDownloaded.length; index += 1) {
      const image = existingDownloaded[index];
      if (!image) continue;
      existingHashes.add(image.hash.slice(0, 32));
      if (seenExistingHashes.has(image.hash)) continue;
      seenExistingHashes.add(image.hash);
      existingReferences.push({
        url: existingReviewUrls[index],
        sourceKind: "web",
        kind: "photo",
        reason: "Imagem já cadastrada na galeria do produto.",
        bytes: image.bytes,
        mime: image.mime,
        hash: image.hash,
      });
    }
    const candidates: ImageCandidate[] = [];
    for (const item of downloaded) {
      if (!item) continue;
      const shortHash = item.hash.slice(0, 32);
      if (seenHashes.has(item.hash) || existingHashes.has(shortHash)) continue;
      seenHashes.add(item.hash);
      candidates.push({
        url: item.entry.imageUrl,
        sourceKind: item.entry.sourceKind,
        kind: "photo",
        reason: `Título: ${item.entry.title} · página: ${item.entry.pageUrl} · ${item.entry.description}`.slice(0, 1200),
        bytes: item.bytes,
        mime: item.mime,
        hash: item.hash,
      });
    }
    const curation = await curateVisually(productName, description, candidates, existingReferences);
    if (!curation.approvedExistingTechnicalCard && !curation.candidates.some((candidate) => candidate.kind === "technical")) {
      const banner = createTechnicalBanner(productName, description);
      if (banner) curation.candidates.push(banner);
    }
    const signedCandidates = [];
    for (const candidate of curation.candidates.slice(0, 8)) {
      signedCandidates.push({
        url: candidate.url,
        source: candidate.sourceKind,
        sourceKind: candidate.sourceKind,
        kind: candidate.kind,
        role: candidate.role,
        topic: candidate.topic,
        reason: candidate.reason,
        token: await signCandidate(tenantId, productName, previewRunId, candidate),
      });
    }
    return jsonResponse({
      productName,
      runId: previewRunId,
      existingUrls,
      approvedExistingUrls: curation.approvedExistingUrls,
      candidates: signedCandidates,
      searched: entries.length,
      verifiedSources: { web: entries.filter((entry) => entry.sourceKind === "web").length, mercadolivre: entries.filter((entry) => entry.sourceKind === "mercadolivre").length },
      curation: signedCandidates.length < candidates.length ? "strict_visual" : "strict_visual_complete",
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
