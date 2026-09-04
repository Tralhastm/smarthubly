// ===== standalone: _shared/auth.ts =====
// Helpers de autenticação para edge functions.


async function _getAuthUser(req: Request) {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.replace("Bearer ", "");
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

export async function isTenantAdmin(adminClient: any, userId: string, tenantId: string) {
  const { data } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("role", "admin")
    .eq("approved", true)
    .maybeSingle();
  if (data) return true;
  // Super admin override
  const { data: sa } = await adminClient
    .from("platform_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  return !!sa;
}

export async function isSuperAdmin(adminClient: any, userId: string) {
  const { data } = await adminClient
    .from("platform_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  return !!data;
}


// ===== standalone: _shared/authorize-caller.ts =====
// Autorização padrão da plataforma: super admin OU admin de tenant.
// Retorna { isSuperAdmin: boolean; tenantId: string | null; tenantIds: string[] }
// e o caller autorizado — usado pelas EFs de prospecção para liberar acesso
// a lojistas mantendo isolamento multi-tenant.


export type CallerAuth = {
  isSuperAdmin: boolean;
  tenantId: string | null;
  tenantIds: string[];
};

async function _authorizeCaller(supabase: any, userId: string): Promise<CallerAuth | { error: string; status: number }> {
  const { data: superRow } = await supabase
    .from("platform_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (superRow) {
    return { isSuperAdmin: true, tenantId: null, tenantIds: [] };
  }

  // Admin de tenant(s): user_roles com approved = true e role admin
  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .eq("approved", true);
  if (error) return { error: `auth_query: ${error.message}`, status: 500 };
  const tenantIds = (roles ?? []).map((r: any) => r.tenant_id).filter(Boolean);
  if (tenantIds.length === 0) {
    return { error: "forbidden", status: 403 };
  }
  return {
    isSuperAdmin: false,
    tenantId: tenantIds[0],
    tenantIds,
  };
}

// Valida que o lead (prospect) pertence ao caller:
// super admin → qualquer lead; lojista → lead do próprio tenant (ou sem tenant
// antigo = leads globais criados antes da migração ficam visíveis pro super admin
// e inacessíveis a lojistas).
function _assertProspectAccess(
  auth: CallerAuth,
  prospect: { tenant_id?: string | null },
): { ok: true } | { error: string; status: number } {
  if (auth.isSuperAdmin) return { ok: true };
  if (prospect.tenant_id === auth.tenantId) return { ok: true };
  return { error: "forbidden", status: 403 };
}


// ===== standalone: _shared/ai-fallback.ts =====
// Helper compartilhado: chama IA com cadeia de fallback
// Lovable AI → Google AI (api_keys do super admin) → AI Workers (ai_workers)
//
// Uso simples:
//   const text = await callAiText(supabase, { systemPrompt, userPrompt });
//   const json = await callAiJson<MyShape>(supabase, { systemPrompt, userPrompt });
//
// Retorna { text, provider } ou lança Error("ai_unavailable") se TODOS falharem.

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

export interface AiCallOptions {
  systemPrompt: string;
  userPrompt: string;
  /** modelo Lovable AI (default: gemini-3-flash-preview) */
  model?: string;
  /** se true, pede JSON object (Lovable + Google) */
  jsonMode?: boolean;
  /** temperature opcional */
  temperature?: number;
  /** max tokens opcional */
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  provider: "lovable" | "google" | "worker";
}

async function getGoogleKeys(supabase: any): Promise<ApiKeyEntry[]> {
  const { data } = await supabase
    .from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}

async function getChatWorkers(supabase: any): Promise<AiWorker[]> {
  const { data: active } = await supabase
    .from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase
    .from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...(active || []), ...(exhausted || [])] as AiWorker[];
}

// 1. Lovable AI Gateway
async function tryLovable(opts: AiCallOptions): Promise<string | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const body: any = {
      model: opts.model || "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    if (opts.jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status === 402 || !res.ok) {
      console.log(`[ai-fallback] Lovable falhou: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    return text || null;
  } catch (e) {
    console.error("[ai-fallback] Lovable exception:", e);
    return null;
  }
}

// 2. Google AI direto (api_keys do super admin)
async function tryGoogle(opts: AiCallOptions, keys: ApiKeyEntry[], supabase: any): Promise<string | null> {
  const allKeys = keys.length > 0
    ? keys
    : (Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : []);
  if (allKeys.length === 0) return null;

  // Contas Google AI novas não têm acesso aos modelos legados (404 "no longer available").
  // Repetir a tentativa com modelos modernos disponíveis para contas novas.
  const AF_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];
  for (const keyEntry of allKeys) {
    for (const modelName of AF_MODELS) {
    try {
      const generationConfig: any = {};
      if (opts.jsonMode) generationConfig.responseMimeType = "application/json";
      if (opts.temperature != null) generationConfig.temperature = opts.temperature;
      if (opts.maxTokens != null) generationConfig.maxOutputTokens = opts.maxTokens;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ text: opts.systemPrompt }] },
              { role: "model", parts: [{ text: "Entendido." }] },
              { role: "user", parts: [{ text: opts.userPrompt }] },
            ],
            generationConfig: Object.keys(generationConfig).length ? generationConfig : undefined,
          }),
        }
      );
      if (res.status === 429 || res.status === 403) {
        if (keyEntry.id !== "__env__") {
          await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        }
        break; // chave esgotada, pular para a próxima chave
      }
      if (res.status === 404) continue; // modelo indisponível nesta conta, tentar o próximo
      if (!res.ok) continue;
      if (keyEntry.id !== "__env__") {
        await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      }
      const data = await res.json();
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (text) return text;
    } catch (e) {
      console.error(`[ai-fallback] Google exception (${modelName}):`, e);
      continue;
    }
    } // modelName
  }
  return null;
}
// 3. AI Workers externos (ai_workers, worker_type='chat')
// Retorna texto puro lendo o stream SSE inteiro do worker.
async function tryWorkers(opts: AiCallOptions, workers: AiWorker[], supabase: any): Promise<string | null> {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes("/functions/")
        ? worker.base_url
        : `${worker.base_url}/functions/v1/ai-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: opts.userPrompt }],
          systemPrompt: opts.systemPrompt,
          tenantName: "Sistema",
          niche: "geral",
        }),
      });
      if (res.status === 429 || res.status === 402 || res.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({
            is_exhausted: true, exhausted_at: new Date().toISOString()
          }).eq("id", worker.id);
        }
        continue;
      }
      if (!res.ok) continue;

      // Lê stream SSE inteiro e concatena
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const t = parsed.choices?.[0]?.delta?.content;
            if (t) fullText += t;
          } catch { /* ignore */ }
        }
      }
      const trimmed = fullText.trim();
      if (trimmed) {
        // Reativa worker se estava esgotado
        if (worker.is_exhausted) {
          await supabase.from("ai_workers").update({
            is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString()
          }).eq("id", worker.id);
        } else {
          await supabase.from("ai_workers").update({
            last_used_at: new Date().toISOString()
          }).eq("id", worker.id);
        }
        return trimmed;
      }
    } catch (e) {
      console.error(`[ai-fallback] Worker ${worker.id} exception:`, e);
      continue;
    }
  }
  return null;
}

/**
 * Cadeia de fallback: Lovable AI → Google (api_keys) → AI Workers (ai_workers).
 * Retorna texto + provider que respondeu, ou lança Error("ai_unavailable").
 */
async function _callAiWithFallback(supabase: any, opts: AiCallOptions): Promise<AiResult> {
  // 1. Lovable
  const r1 = await tryLovable(opts);
  if (r1) return { text: r1, provider: "lovable" };

  // 2. Google keys (api_keys do super admin)
  console.log("[ai-fallback] Lovable falhou, tentando Google keys...");
  const keys = await getGoogleKeys(supabase);
  const r2 = await tryGoogle(opts, keys, supabase);
  if (r2) return { text: r2, provider: "google" };

  // 3. AI Workers
  console.log("[ai-fallback] Google falhou, tentando AI Workers...");
  const workers = await getChatWorkers(supabase);
  const r3 = await tryWorkers(opts, workers, supabase);
  if (r3) return { text: r3, provider: "worker" };

  throw new Error("ai_unavailable");
}

/** Conveniência: retorna só o texto. */
async function _callAiText(supabase: any, opts: AiCallOptions): Promise<string> {
  const r = await _callAiWithFallback(supabase, opts);
  return r.text;
}

/**
 * Chamada VISION (multi-modal): a mesma cadeia de fallback, mas enviando
 * imagem em base64 junto ao prompt. Usado para leitura de catálogos (PDF->img,
 * foto de tabela de preços etc.). Apenas o provider Google AI suporta imagem
 * nativamente; Lovable/Workers recebem o prompt texto (OCR embutido).
 */
async function tryGoogleVision(
  opts: AiCallOptions & { imageData?: { data: string; mimeType: string } },
  keys: ApiKeyEntry[],
  supabase: any,
): Promise<string | null> {
  const allKeys = keys.length > 0
    ? keys
    : (Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : []);
  if (allKeys.length === 0 || !opts.imageData) return null;

  const VF_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-3-flash-lite", "gemini-3.5-flash-lite"];
  for (const keyEntry of allKeys) {
    for (const modelName of VF_MODELS) {
      try {
        const generationConfig: any = {};
        if (opts.jsonMode) generationConfig.responseMimeType = "application/json";
        if (opts.temperature != null) generationConfig.temperature = opts.temperature;
        if (opts.maxTokens != null) generationConfig.maxOutputTokens = opts.maxTokens;

        const parts: any[] = [{ text: `${opts.systemPrompt}\n\n${opts.userPrompt}` }];
        if (opts.imageData?.data) {
          parts.push({
            inlineData: { mimeType: opts.imageData.mimeType, data: opts.imageData.data },
          });
        }

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keyEntry.api_key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: Object.keys(generationConfig).length ? generationConfig : undefined,
            }),
          }
        );
        if (res.status === 429 || res.status === 403) {
          if (keyEntry.id !== "__env__") {
            await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
          }
          break;
        }
        if (res.status === 404) continue;
        if (!res.ok) continue;
        if (keyEntry.id !== "__env__") {
          await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
        }
        const data = await res.json();
        const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (text) return text;
      } catch (e) {
        console.error(`[ai-fallback] Vision exception (${modelName}):`, e);
        continue;
      }
    }
  }
  return null;
}

async function _callAiVisionJson<T = unknown>(
  supabase: any,
  opts: AiCallOptions & { imageData: { data: string; mimeType: string } },
): Promise<T> {
  const keys = await getGoogleKeys(supabase);
  const text = await tryGoogleVision({ ...opts, jsonMode: true }, keys, supabase);
  if (!text) throw new Error("ai_unavailable");
  try { return JSON.parse(text) as T; } catch { /* ignore */ }
  const m = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) throw new Error("ai_invalid_json");
  return JSON.parse(m[0]) as T;
}

/** Conveniência: extrai JSON da resposta (procura primeiro `{...}` ou `[...]`). */
async function _callAiJson<T = unknown>(supabase: any, opts: AiCallOptions): Promise<T> {
  const r = await _callAiWithFallback(supabase, { ...opts, jsonMode: true });
  // Tenta parsear direto, senão extrai bloco
  try { return JSON.parse(r.text) as T; } catch { /* ignore */ }
  const m = r.text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) throw new Error("ai_invalid_json");
  return JSON.parse(m[0]) as T;
}


// ===== main: import-supplier-catalog =====
// Edge Function: importação de catálogo de fornecedor com IA
//
// POST /functions/v1/import-supplier-catalog
// Body JSON:
//   {
//     "supplierId": "<supplier.id>",          // obrigatório
//     "kind": "pdf" | "image" | "txt",       // obrigatório
//     "content": "<base64 ou texto plano>",  // obrigatório
//     "merge": true/false (default true)     // true = upsert (mantém preços manuais existentes)
//   }
//
// Fluxo:
//   1. Valida JWT do usuário (getAuthUser do _shared/auth.ts).
//   2. Se PDF: extrai texto com pdfjs (esm.sh). Se escaneado sem texto → erro
//      orientando enviar as páginas como imagem.
//   3. Se imagem: envia inlineData ao Gemini vision (callAiVisionJson).
//   4. Se txt: envia como texto (callAiJson).
//   5. IA devolve { items: [{ name, price, available? }], warnings? }.
//   6. Upsert em supplier_product_prices (merge=true, padrão) ou substituição
//      total (merge=false).
//   7. Retorna { total, saved, skipped, warnings, items }.

import { createClient } from "npm:@supabase/supabase-js@2";




const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CatalogItem {
  name?: string;
  product_name?: string;
  price?: number;
  unit_price?: number;
  preco?: number;
  cost_price?: number;
  cost?: number;
  custo?: number;
  resale_price?: number;
  resale?: number;
  venda_sugerida?: number;
  category?: string;
  categoria?: string;
  available?: boolean;
  disponivel?: boolean;
  unit?: string;
  variants?: Array<{ name?: string; price?: number; cost_price?: number; resale_price?: number; available?: boolean }>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pdfToText(base64: string): Promise<string> {
  const pdfjsLib = await import("https://esm.sh/pdfjs-dist@4.10.38/build/pdf.mjs");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  let full = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items
      .filter((it: any) => "str" in it)
      .map((it: any) => it.str);
    full += strings.join(" ").trim() + "\n";
  }
  return full.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const user = await _getAuthUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const auth = await _authorizeCaller(admin as any, user.id);
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  try {
    const body = await req.json().catch(() => ({}));
    let { supplierId, supplierName, kind, content, merge = true, priceType = 'both', profitMargin = 0, shippingFee = 0, tenantId } = body || {};

    if ((!supplierId && !supplierName) || !kind || !content) {
      return json({ error: "missing_fields" }, 400);
    }

    // --- Lógica de Criação Automática de Fornecedor ---
    if (!supplierId && supplierName && (tenantId || auth.tenantId)) {
      const tid = tenantId || auth.tenantId;
      const { data: existing } = await admin.from('suppliers').select('id').eq('tenant_id', tid).ilike('name', supplierName.trim()).single();
      if (existing) {
        supplierId = existing.id;
      } else {
        const { data: newSup } = await admin.from('suppliers').insert({
          tenant_id: tid,
          name: supplierName.trim(),
          active: true
        }).select('id').single();
        supplierId = newSup?.id;
      }
    }

    if (!supplierId) return json({ error: "supplier_id_or_name_required" }, 400);
    if (!["pdf", "image", "txt"].includes(kind)) {
      return json({ error: "invalid_kind" }, 400);
    }

    // O fornecedor deve pertencer a um tenant acessível ao caller
    const { data: supplier, error: sErr } = await admin
      .from("suppliers")
      .select("id, name, tenant_id")
      .eq("id", supplierId)
      .maybeSingle();
    if (sErr || !supplier) {
      return json({ error: "supplier_not_found" }, 404);
    }
    if (!auth.isSuperAdmin && supplier.tenant_id !== auth.tenantId) {
      return json({ error: "forbidden" }, 403);
    }

    let text = "";
    let imageData: { data: string; mimeType: string } | undefined;

    if (kind === "pdf") {
      try {
        text = await pdfToText(content);
      } catch (e: any) {
        return json({ error: "pdf_parse_failed", detail: String(e?.message || e) }, 422);
      }
      if (!text || text.length < 10) {
        return json({
          error: "pdf_no_text",
          hint: "Este PDF parece ser escaneado (sem texto). Envie as páginas como imagens para a IA ler.",
        }, 422);
      }
    } else if (kind === "image") {
      let b64 = content;
      let mimeType = "image/png";
      const m = content.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.*)$/);
      if (m) {
        mimeType = m[1];
        b64 = m[2];
      }
      imageData = { data: b64, mimeType };
    } else {
      text = String(content);
    }

    const SYSTEM = `Você é um extrator de dados de catálogos de fornecedores brasileiros. O usuário enviou um catálogo (texto de PDF, imagem ou texto puro). Extraia TODOS os produtos com preços.`;

    const USER = `Extraia desta ${kind === "pdf" ? "lista em texto extraída de um PDF" : kind === "image" ? "imagem de catálogo" : "lista de texto"} TODOS os produtos com preços em reais (R$).

Regras obrigatórias:
- Reconheça tanto produtos em uma única linha (ex.: "Galaxy A07 128GB - CUSTO: R$ 750 - REVENDA: R$ 849") quanto produtos em bloco, com o nome em uma linha e os valores nas linhas seguintes (ex.: "Galaxy A07 128GB", depois "Custo: R$ 750", depois "Venda sugerida: R$ 849").
- Títulos de seção ou marca isolados, como SAMSUNG, MOTOROLA, REALME, XIAOMI REDMI, REDMI NOTE e POCO, não são produtos; use-os como category quando apropriado.
- Retorne TODOS os itens identificados e agrupe somente opções do mesmo modelo. Preserve capacidade, RAM, 4G/5G, NFC, Pro, Max, edição e outras características técnicas do nome. Quando cor, capacidade ou outra opção tiver custo diferente, retorne "variants": [{ name, price, cost_price, resale_price, available }], uma opção por variação, usando o menor custo/preço como base. Nunca invente diferenças.
- Para cada item, retorne { name, price, cost_price, resale_price, category, available, variants }. Use price como o preço de venda/resale quando existir; se só houver custo, use o custo. Os campos cost_price e resale_price devem ser números, ou 0 quando ausentes.
- Aceite valores como "R$ 1.099", "R$ 1.099,90", "1099,90", "1.099.90" e tabelas/colunas. Não confunda pontos de milhar com casas decimais.
- Se um produto tiver custo e venda em linhas diferentes, associe ambos ao nome imediatamente anterior até começar outro produto ou seção.
- Normalize somente espaços e caracteres estranhos; não remova informações técnicas relevantes do nome.
- NÃO invente itens nem preços. Se a imagem ou trecho não estiver legível, extraia apenas o que conseguir e inclua warnings.
- available: true por padrão, a menos que esteja marcado como esgotado, indisponível ou fora de estoque.

Responda APENAS com JSON no formato: { "items": [{ "name": "...", "price": 0, "cost_price": 0, "resale_price": 0, "category": "...", "available": true, "variants": [] }], "warnings": [] }`;

    let items: CatalogItem[] = [];
    let warnings: string[] = [];

    try {
      if (kind === "image") {
        const res: any = await _callAiVisionJson(admin, {
          systemPrompt: SYSTEM,
          userPrompt: USER,
          imageData: imageData!,
          temperature: 0.1,
        });
        items = res?.items || [];
        warnings = res?.warnings || [];
      } else {
        const res: any = await _callAiJson(admin, {
          systemPrompt: SYSTEM,
          userPrompt: `CONTEÚDO DO CATÁLOGO:\n${text.slice(0, 30000)}\n\n${USER}`,
          temperature: 0.1,
        });
        items = res?.items || [];
        warnings = res?.warnings || [];
      }
    } catch (e: any) {
      return json({ error: "ai_unavailable", detail: String(e?.message || e) }, 503);
    }

    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "no_items_extracted", warnings }, 422);
    }

    let skipped = 0;

    if (!merge) {
      await admin.from("supplier_product_prices").delete().eq("supplier_id", supplierId);
      for (const it of items) {
        const name = String(it.name || it.product_name || "").trim().toLowerCase();
        const cost = Number(it.cost_price ?? it.cost ?? it.custo ?? NaN);
        const resale = Number(it.resale_price ?? it.resale ?? it.venda_sugerida ?? it.price ?? it.unit_price ?? it.preco ?? NaN);
        const price = priceType === 'resale' ? (Number.isFinite(resale) && resale > 0 ? resale : cost) : (Number.isFinite(cost) && cost > 0 ? cost : resale);
        if (!name || !Number.isFinite(price) || price <= 0) {
          skipped++;
          continue;
        }
        await admin.from("supplier_product_prices").insert({
          supplier_id: supplierId,
          product_name: name,
          unit_price: price,
          available: it.available ?? it.disponivel ?? true,
          price_types: priceType === 'both' ? ['cost', 'resale'] : [priceType],
          metadata: { profit_margin: profitMargin, shipping_fee: shippingFee, resale_price: Number.isFinite(resale) && resale > 0 ? resale : null, category: it.category ?? it.categoria ?? null, variants: Array.isArray(it.variants) ? it.variants : [] }
        });
      }
      return json({ total: items.length, skipped, warnings, items: items.slice(0, 100) });
    }

    // merge=true: upsert (conflito supplier_id,product_name) — preserva preços manuais
    // só se o catálogo não trouxer o item; traz preço novo sempre que o item aparece.
    for (const it of items) {
      const name = String(it.name || it.product_name || "").trim().toLowerCase();
      const cost = Number(it.cost_price ?? it.cost ?? it.custo ?? NaN);
      const resale = Number(it.resale_price ?? it.resale ?? it.venda_sugerida ?? it.price ?? it.unit_price ?? it.preco ?? NaN);
      const price = priceType === 'resale' ? (Number.isFinite(resale) && resale > 0 ? resale : cost) : (Number.isFinite(cost) && cost > 0 ? cost : resale);
      if (!name || !Number.isFinite(price) || price <= 0) {
        skipped++;
        continue;
      }
      const { error } = await admin.from("supplier_product_prices").upsert(
        {
          supplier_id: supplierId,
          product_name: name,
          unit_price: price,
          available: it.available ?? it.disponivel ?? true,
          price_types: priceType === 'both' ? ['cost', 'resale'] : [priceType],
          metadata: { profit_margin: profitMargin, shipping_fee: shippingFee, resale_price: Number.isFinite(resale) && resale > 0 ? resale : null, category: it.category ?? it.categoria ?? null, variants: Array.isArray(it.variants) ? it.variants : [] }
        },
        { onConflict: "supplier_id,product_name" },
      );
      if (error) {
        console.error("[import-supplier-catalog] upsert erro:", error);
        skipped++;
      }
    }

    const { count: saved, error: cErr } = await admin
      .from("supplier_product_prices")
      .select("*", { count: "exact", head: true })
      .eq("supplier_id", supplierId);
    if (cErr) console.error("[import-supplier-catalog] count erro:", cErr);

    return json({ total: items.length, saved: saved || 0, skipped, warnings, items: items.slice(0, 100) });
  } catch (e: any) {
    console.error("[import-supplier-catalog] erro:", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});



