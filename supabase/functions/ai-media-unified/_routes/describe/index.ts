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

const SYSTEM_PROMPT =
  "Você escreve descrições comerciais bonitas e específicas para produtos de e-commerce em português brasileiro. " +
  "Comece com uma abordagem de vendedor ligada ao produto, nunca com frases genéricas. " +
  "Use especificações reais encontradas na pesquisa ou informadas no nome; nunca invente memória, câmera, tela, bateria, processador ou conectividade. " +
  "Não mencione nota fiscal, preço, custo ou margem. Não use emojis, markdown, listas ou promessas absolutas. " +
  "Finalize com a garantia de forma profissional e respeite integralmente as regras personalizadas do lojista. Retorne somente o texto final.";

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
  let d = (s || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (d.length > 900) d = d.slice(0, 897) + "...";
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
            generationConfig: { temperature: 0.55, maxOutputTokens: 900 },
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
      researchWeb ? `Pesquise no Google informações atuais e confiáveis sobre o modelo "${name}" antes de escrever. Use apenas especificações confirmadas; não inclua links ou fontes no texto.` : "",
      rules ? `Regras personalizadas do lojista (obrigatórias): ${String(rules).slice(0, 3000)}` : "",
      "Escreva uma descrição comercial específica, com as principais especificações confirmadas, e finalize com a garantia conforme as regras.",
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
