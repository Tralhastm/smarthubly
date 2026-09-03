// Gera descrição vendedora curta com fallback multi-provider:
// Google → Lovable → OpenRouter → Workers externos.
// Sempre retorna 200 com { description? , error? } pra cliente conseguir ler o erro.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

const MAX_DESCRIPTION_CHARS = 3600;
const GUARANTEE_TEXT = "Garantia de 30 dias contra defeitos de funcionamento. Não cobre quedas, quebras, mau uso, danos físicos, contato inadequado com líquidos ou alterações no aparelho.";

const SYSTEM_PROMPT =
  "Você escreve descrições de produtos para uma loja profissional. Use português brasileiro simples, natural e objetivo, sem exageros, metáforas, frases de propaganda vazias ou palavras como centro de performance, vida inteira de arquivos e nova era. " +
  "Quando solicitado, pesquise na internet real e use somente especificações confirmadas; nunca invente memória, câmera, tela, bateria, processador ou conectividade. " +
  "Siga sem exceção este formato: primeiro parágrafo com 2 ou 3 frases sobre o produto e o benefício principal; uma linha em branco; segundo parágrafo com 2 ou 3 frases sobre recursos e uso; uma linha em branco; especificações técnicas, uma por linha, sem bullets, hífens, numeração ou título; uma linha em branco; garantia. " +
  "Use no máximo 15 especificações realmente confirmadas e não repita informações. Não inclua links, fontes, preço, custo, margem, nota fiscal, emojis, markdown ou promessas absolutas. " +
  "Preserve as quebras de linha. Retorne somente o texto final, sem reticências, sem cortar frases e sem escrever informações não confirmadas.";

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase
    .from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}

async function getAllWorkers(supabase: any) {
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

function clean(s: string): string {
  let d = (s || "").trim().replace(/^```(?:text|markdown)?\s*|\s*```$/gi, "").trim();
  const hasEllipsis = /\.{2,}/.test(d);
  d = d
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/^[ \t]*[-*•]\s+/, "").replace(/^[ \t]*\d+[.)]\s+/, "").replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/^Especificações\s*\n/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (hasEllipsis || !d) return "";
  const guaranteeStart = /Garantia de 30 dias contra defeitos de funcionamento\./i;
  const guaranteeIndex = d.search(guaranteeStart);
  d = guaranteeIndex >= 0 ? `${d.slice(0, guaranteeIndex).trim()}\n\n${GUARANTEE_TEXT}` : `${d}\n\n${GUARANTEE_TEXT}`;

  if (d.length > MAX_DESCRIPTION_CHARS) {
    const guaranteePos = d.lastIndexOf(`\n\n${GUARANTEE_TEXT}`);
    const body = guaranteePos >= 0 ? d.slice(0, guaranteePos).trim() : d;
    const maxBodyChars = MAX_DESCRIPTION_CHARS - GUARANTEE_TEXT.length - 2;
    const complete = body.slice(0, maxBodyChars + 1).match(/^.*[.!?](?=\s|$)/s);
    if (!complete?.[0]) return "";
    d = `${complete[0].trim()}\n\n${GUARANTEE_TEXT}`;
  }
  return d;
}

async function tryGoogle(prompt: string, keys: ApiKeyEntry[], supabase: any, researchWeb = false): Promise<string | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];
  for (const keyEntry of allKeys) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
              { role: "model", parts: [{ text: "Ok." }] },
              { role: "user", parts: [{ text: prompt }] },
            ],
            ...(researchWeb ? { tools: [{ google_search: {} }] } : {}),
            generationConfig: { temperature: 0.2, maxOutputTokens: 1800 },
          }),
        }
      );
      if (r.status === 429 || r.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!r.ok) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      const data = await r.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return clean(text);
    } catch (e) { console.error("desc Google failed", e); continue; }
  }
  return null;
}

async function tryLovable(prompt: string): Promise<string | null> {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1800,
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    return text ? clean(text) : null;
  } catch { return null; }
}

async function tryOpenRouter(prompt: string): Promise<string | null> {
  const KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!KEY) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1800,
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    return text ? clean(text) : null;
  } catch { return null; }
}

async function tryWorkers(prompt: string, workers: AiWorker[], supabase: any): Promise<string | null> {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          systemPrompt: SYSTEM_PROMPT,
          tenantName: "describer",
          niche: "produto",
        }),
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        }
        continue;
      }
      if (!response.ok) continue;
      // SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "", result = "";
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
            if (t) result += t;
          } catch {}
        }
      }
      if (result) {
        if (worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", worker.id);
        } else {
          await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
        }
        return clean(result);
      }
    } catch (e) { console.error(`desc worker ${worker.id} failed`, e); continue; }
  }
  return null;
}

export async function describe_route(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { name, category, network, currentDescription, rules, researchWeb } = parsed;
    if (!name || typeof name !== "string") return respond({ error: "name é obrigatório" }, 400);

    const userPrompt = [
      `Produto: ${name}`,
      category ? `Categoria: ${category}` : "",
      network ? `Loja: ${network}` : "",
      currentDescription ? `Descrição atual (refazer melhor): ${currentDescription}` : "",
      researchWeb ? `Pesquise no Google informações atuais e confiáveis sobre "${name}" antes de escrever. Use apenas especificações confirmadas; não inclua links ou fontes no texto.` : "",
      rules ? `Regras personalizadas do lojista (obrigatórias): ${String(rules).slice(0, 2200)}` : "",
      `Pesquise na internet real antes de escrever. Entregue exatamente dois parágrafos curtos, naturais e específicos, separados por uma linha em branco; depois uma linha em branco e no máximo 15 especificações confirmadas, uma por linha, sem título ou marcadores; depois uma linha em branco e exatamente este aviso: ${GUARANTEE_TEXT} O texto pode ter até ${MAX_DESCRIPTION_CHARS} caracteres. Não use reticências e não termine no meio de uma frase.`,
    ].filter(Boolean).join("\n");

    const supabase = getSupabaseAdmin();
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    let d = await tryGoogle(userPrompt, keys, supabase, researchWeb === true);
    if (d) return respond({ description: d, provider: "google" });

    console.log("desc: Google falhou, tentando Lovable...");
    d = await tryLovable(userPrompt);
    if (d) return respond({ description: d, provider: "lovable" });

    console.log("desc: Lovable falhou, tentando OpenRouter...");
    d = await tryOpenRouter(userPrompt);
    if (d) return respond({ description: d, provider: "openrouter" });

    console.log("desc: OpenRouter falhou, tentando workers...");
    d = await tryWorkers(userPrompt, workers, supabase);
    if (d) return respond({ description: d, provider: "worker" });

    return respond({ error: "Todos os provedores de IA estão indisponíveis ou sem crédito agora. Tenta de novo em alguns minutos." });
  } catch (e) {
    console.error("generate-product-description error", e);
    return respond({ error: e instanceof Error ? e.message : "Erro desconhecido" }, 500);
  }

  } catch (e) {
    console.error("[unified:describe] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
