import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PARSE_PROMPT = (txtContent: string) => `Você é um parser de produtos. Extraia os produtos do texto abaixo.
Para cada produto extraia: name, price (número), category (inferida do nome), description (curta e atrativa).
Se o preço não estiver claro, coloque 0.

Responda APENAS com JSON válido neste formato exato, sem markdown:
{"products": [{"name": "...", "price": 0, "category": "...", "description": "..."}]}

Texto:
${txtContent}`;

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; }
interface ParsedProduct {
  name: string;
  price: number;
  category: string;
  description: string;
}

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Remove emojis e símbolos decorativos comuns
function stripDecor(line: string): string {
  return line
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "") // emojis
    .replace(/^[\s\-=*•·●◆▪■□▶►★☆♥♦♣♠–—_~|>«»#]+/, "")
    .replace(/[\s\-=*•·●◆▪■□◀◁★☆♥♦♣♠–—_~|<«»#]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCategoryName(value: string) {
  const cleaned = stripDecor(value);
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

// Header de seção: linha sem preço, curta (<=60 chars), em CAPS ou claramente decorada (=== X ===, --- X ---, ## X)
function isSectionHeader(line: string) {
  const stripped = stripDecor(line);
  if (!stripped || stripped.length > 60) return false;
  if (extractPrice(line) !== null) return false;
  // Decorada com ===, ---, ##, [ ], ** **
  if (/^[-=*#\[\]【】「」\s]*[A-Za-zÀ-ÿ0-9 &/]+[-=*#\[\]【】「」\s]*$/u.test(line.trim()) &&
      /[-=*#\[\]【】「」]{2,}/.test(line.trim())) return true;
  // Maiúsculas (>= 70% das letras são maiúsculas e tem >= 2 palavras OU 1 palavra >= 4 letras)
  const letters = stripped.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length === 0) return false;
  const upper = letters.replace(/[^A-ZÀ-Ý]/g, "").length;
  const ratio = upper / letters.length;
  const wordCount = stripped.split(/\s+/).length;
  if (ratio >= 0.7 && (wordCount >= 2 || letters.length >= 4)) return true;
  return false;
}

// Extrai preço em qualquer posição da linha. Aceita: R$ 1.500,00 | R$1500 | 1500 | 1.500,00 | 1,5k | 1.5K | 99.90 (US)
function extractPrice(line: string): number | null {
  const text = line.replace(/\u00A0/g, " ");

  // 1) Formato com "k" ou "K" (ex: 1.5k, 2k, 1,5K)
  const kMatch = text.match(/(?:R\$\s*)?(\d+(?:[.,]\d+)?)\s*[kK]\b/);
  if (kMatch) {
    const v = Number(kMatch[1].replace(",", "."));
    if (Number.isFinite(v)) return Math.round(v * 1000 * 100) / 100;
  }

  // 2) Formato BR explícito com R$ (ex: R$ 1.500,00 | R$1500 | R$ 99,90)
  const brWithSymbol = text.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (brWithSymbol) {
    const cleaned = brWithSymbol[1].replace(/\./g, "").replace(",", ".");
    const v = Number(cleaned);
    if (Number.isFinite(v) && v > 0) return v;
  }

  // 3) Número com vírgula decimal BR (ex: 1.500,00 ou 99,90)
  const brNum = text.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2})(?:\s|$)/);
  if (brNum) {
    const cleaned = brNum[1].replace(/\./g, "").replace(",", ".");
    const v = Number(cleaned);
    if (Number.isFinite(v) && v > 0) return v;
  }

  // 4) Número US com ponto decimal (ex: 99.90, 1500.00) — só se tiver ponto decimal
  const usNum = text.match(/(?:^|\s)(\d+\.\d{1,2})(?:\s|$)/);
  if (usNum) {
    const v = Number(usNum[1]);
    if (Number.isFinite(v) && v > 0) return v;
  }

  // 5) Inteiro puro >= 10 (evita pegar "1" de listas) — última linha de cada bloco geralmente
  const intMatch = text.match(/(?:^|\s)(\d{2,6})(?:\s|$)/);
  if (intMatch) {
    const v = Number(intMatch[1]);
    if (Number.isFinite(v) && v >= 10 && v <= 999999) return v;
  }

  return null;
}

// Remove o trecho do preço da linha pra extrair o nome limpo
function stripPriceFromLine(line: string): string {
  return line
    .replace(/R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?/g, "")
    .replace(/R\$\s*\d+(?:,\d{1,2})?/g, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*[kK]\b/g, "")
    .replace(/\b\d{1,3}(?:\.\d{3})+,\d{1,2}\b/g, "")
    .replace(/\b\d+,\d{1,2}\b/g, "")
    .replace(/\b\d+\.\d{1,2}\b/g, "")
    .replace(/\s*[-–—:|]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function inferCategory(name: string, fallback = "Geral") {
  const text = normalizeText(name);
  // Salão de beleza
  if (/(sobrancel|henna|brow|micropigment)/.test(text)) return "Sobrancelhas";
  if (/(manicure|pedicure|unha|gel|fibra|nail|esmalta)/.test(text)) return "Unhas";
  if (/(cilio|lash|volume russo|fio a fio)/.test(text)) return "Cílios";
  if (/(depil|virilha|axila|buco|perna)/.test(text)) return "Depilação";
  if (/(limpeza de pele|^pele|spa|massagem)/.test(text)) return "Estética";
  // Bebidas
  if (/(cerveja|chopp|long neck|heineken|brahma|skol|stella|corona|budweiser)/.test(text)) return "Cervejas";
  if (/(whisky|whiskey|vodka|gin|rum|cachaca|tequila|conhaque|absinto)/.test(text)) return "Destilados";
  if (/(vinho|tinto|branco|espumante|champag|prosecco)/.test(text)) return "Vinhos";
  if (/(refrigerante|coca|guarana|sprite|fanta|pepsi|sukita)/.test(text)) return "Refrigerantes";
  if (/(suco|agua|energetico|red bull|monster)/.test(text)) return "Não Alcoólicos";
  // Comida
  if (/(pizza|hamburg|burger|x-|sanduiche|lanche|hot dog)/.test(text)) return "Lanches";
  if (/(porcao|fritas|polenta|tabua)/.test(text)) return "Porções";
  if (/(sobremesa|sorvete|pudim|brigadeiro|torta|bolo)/.test(text)) return "Sobremesas";
  return fallback || "Geral";
}

/**
 * Parser local robusto. Estratégia:
 * 1. Divide o texto em BLOCOS separados por uma ou mais linhas vazias.
 * 2. Cada bloco vira um produto: 1ª linha (sem preço) = nome; linhas seguintes = descrição;
 *    preço é extraído de qualquer linha do bloco (a que tiver número).
 * 3. Linhas que parecem header de seção (CAPS, ===, ---) viram a categoria atual.
 * 4. Se o TXT for em formato compacto "Nome - R$ 99,90" por linha, cada linha vira um produto.
 */
function parseLocally(txtContent: string): { products: ParsedProduct[] } {
  // Normaliza quebras de linha
  const raw = txtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Quebra em blocos separados por linha vazia
  const blocks = raw.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);

  const products: ParsedProduct[] = [];
  let currentCategory = "Geral";

  for (const block of blocks) {
    const blockLines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (blockLines.length === 0) continue;

    // Bloco é um header isolado de seção?
    if (blockLines.length === 1 && isSectionHeader(blockLines[0])) {
      currentCategory = cleanCategoryName(blockLines[0]) || currentCategory;
      continue;
    }

    // Se o bloco tem apenas 1 ou 2 linhas, trata como linhas individuais (formato compacto)
    // Cada linha com preço = um produto
    const linesWithPrice = blockLines.filter(l => extractPrice(l) !== null);
    const linesNoPrice = blockLines.filter(l => extractPrice(l) === null);

    // CASO A: bloco multi-linha onde só algumas linhas têm preço → cada linha-com-preço é um produto
    // (típico de lista compacta tipo "Heineken 600ml - R$ 18,00")
    if (linesWithPrice.length >= 2 && linesNoPrice.length <= 1) {
      // Linha sem preço (se houver) pode ser header da seção
      if (linesNoPrice.length === 1 && isSectionHeader(linesNoPrice[0])) {
        currentCategory = cleanCategoryName(linesNoPrice[0]) || currentCategory;
      }
      for (const line of linesWithPrice) {
        const price = extractPrice(line)!;
        const name = stripPriceFromLine(stripDecor(line));
        if (!name) continue;
        products.push({
          name,
          price,
          category: inferCategory(name, currentCategory),
          description: "",
        });
      }
      continue;
    }

    // CASO B: bloco descreve UM produto (1ª linha = nome, demais = descrição, preço em qualquer linha)
    let priceLine = -1;
    let price = 0;
    for (let i = 0; i < blockLines.length; i++) {
      const p = extractPrice(blockLines[i]);
      if (p !== null) { price = p; priceLine = i; break; }
    }

    // Pega 1ª linha não-vazia como nome (tira preço se estiver na 1ª linha)
    const rawNameLine = blockLines[0];
    let name = stripPriceFromLine(stripDecor(rawNameLine));
    // Se a 1ª linha era SÓ preço, usa a 2ª como nome
    if (!name && blockLines[1]) {
      name = stripPriceFromLine(stripDecor(blockLines[1]));
    }
    if (!name) continue;

    // Descrição: linhas restantes (exceto a do nome e a do preço se for outra)
    const descLines: string[] = [];
    for (let i = 1; i < blockLines.length; i++) {
      if (i === priceLine && extractPrice(blockLines[i]) !== null && stripPriceFromLine(stripDecor(blockLines[i])) === "") continue;
      const cleaned = stripDecor(blockLines[i]).replace(/R\$\s*[\d.,]+/g, "").replace(/\s{2,}/g, " ").trim();
      if (cleaned) descLines.push(cleaned);
    }

    products.push({
      name,
      price,
      category: inferCategory(name, currentCategory),
      description: descLines.join(" ").slice(0, 500),
    });
  }

  return { products };
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
    .eq("worker_type", "txt")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as AiWorker[];
}

async function tryGoogle(txtContent: string, keys: ApiKeyEntry[], supabase: any): Promise<any | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];

  for (const keyEntry of allKeys) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: PARSE_PROMPT(txtContent) }] }],
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
      if (!textContent) continue;
      return JSON.parse(textContent);
    } catch (e) { console.error("Google attempt failed:", e); continue; }
  }
  return null;
}

async function tryLovable(txtContent: string): Promise<any | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: "Responda APENAS com JSON válido, sem markdown." }, { role: "user", content: PARSE_PROMPT(txtContent) }],
      }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch { return null; }
}

async function tryOpenRouter(txtContent: string): Promise<any | null> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "system", content: "Responda APENAS com JSON válido, sem markdown." }, { role: "user", content: PARSE_PROMPT(txtContent) }],
      }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch { return null; }
}

async function tryWorker(txtContent: string, workers: AiWorker[], supabase: any): Promise<any | null> {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-parse-txt`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txtContent }),
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { txtContent, supplierName, priceType, profitMargin, shippingFee, tenantId } = body;
    
    if (!txtContent || typeof txtContent !== "string") {
      return new Response(JSON.stringify({ error: "txtContent is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = getSupabaseAdmin();
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAiWorkers(supabase)]);

    const r1 = await tryGoogle(txtContent, keys, supabase);
    if (r1) return new Response(JSON.stringify(r1), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const r2 = await tryLovable(txtContent);
    if (r2) return new Response(JSON.stringify(r2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const r3 = await tryOpenRouter(txtContent);
    if (r3) return new Response(JSON.stringify(r3), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const r4 = await tryWorker(txtContent, workers, supabase);
    if (r4) return new Response(JSON.stringify(r4), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // --- Nova Lógica de Ingestão com Fornecedor ---
    let targetSupplierId = null;
    if (supplierName && tenantId) {
      // Busca ou cria o fornecedor
      const { data: existing } = await supabase.from('suppliers').select('id').eq('tenant_id', tenantId).ilike('name', supplierName.trim()).single();
      if (existing) {
        targetSupplierId = existing.id;
      } else {
        const { data: newSup } = await supabase.from('suppliers').insert({
          tenant_id: tenantId,
          name: supplierName.trim(),
          active: true
        }).select('id').single();
        targetSupplierId = newSup?.id;
      }
    }

    const fallback = parseLocally(txtContent);
    if (fallback.products) {
      fallback.products = fallback.products.map(p => ({
        ...p,
        supplier_id: targetSupplierId,
        price_type: priceType || 'both',
        profit_margin: profitMargin || 0,
        shipping_fee: shippingFee || 0
      }));
    }
    if (fallback.products.length > 0) {
      console.info(`parse-products-txt: IA indisponível, usando parser local (${fallback.products.length} itens)`);
      return new Response(JSON.stringify(fallback), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Não consegui interpretar esse TXT nem com IA nem com leitura local. Verifique se cada item termina com preço, por exemplo: Nome - R$ 35,00" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
