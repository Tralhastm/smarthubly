// Categoriza itens usando fallback multi-provider: Google → Lovable → OpenRouter → Workers externos
// POST { items: [{id, name, description}], context: "Loja de X (nicho)" }
// Sempre retorna 200 com { ok, results?, error? } pra cliente conseguir ler o erro.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

function respond(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

function buildPrompt(items: any[], context?: string) {
  const list = items.slice(0, 80).map((it: any, i: number) =>
    `${i + 1}. id=${it.id} | nome=${it.name}${it.description ? ` | desc=${String(it.description).slice(0, 120)}` : ''}`
  ).join('\n');
  const sys = `Você categoriza itens de uma loja (${context || 'loja brasileira'}). Pra CADA item devolva uma category curta (1-2 palavras, ex: "Bebidas", "Mão de obra", "Eletrônicos") e uma subcategory mais específica (ex: "Cervejas", "Pintura", "Smartphones"). Use português brasileiro. Categorias devem agrupar coisas parecidas — não invente nomes únicos. Se ambíguo, use "Geral" / "Outros". Responda APENAS um JSON válido no formato: {"results":[{"id":"...","category":"...","subcategory":"..."}]}`;
  const user = `Categorize estes itens:\n\n${list}`;
  return { sys, user };
}

function parseResults(text: string): any[] | null {
  try {
    // tenta extrair o primeiro bloco JSON
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.results) ? parsed.results : null;
  } catch { return null; }
}

// 1. Google AI
async function tryGoogle(items: any[], context: string | undefined, keys: ApiKeyEntry[], supabase: any): Promise<any[] | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];
  if (allKeys.length === 0) return null;
  const { sys, user } = buildPrompt(items, context);
  for (const keyEntry of allKeys) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ text: sys }] },
              { role: "model", parts: [{ text: "Entendido, devolvo só o JSON." }] },
              { role: "user", parts: [{ text: user }] },
            ],
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
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const results = parseResults(text);
      if (results) return results;
    } catch (e) { console.error("auto-categorize Google failed:", e); continue; }
  }
  return null;
}

// 2. Lovable AI (com tool calling)
async function tryLovable(items: any[], context: string | undefined): Promise<any[] | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return null;
  const { sys, user } = buildPrompt(items, context);
  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        tools: [{
          type: 'function',
          function: {
            name: 'categorize_items',
            description: 'Devolve categoria e subcategoria de cada item',
            parameters: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      category: { type: 'string' },
                      subcategory: { type: 'string' },
                    },
                    required: ['id', 'category', 'subcategory'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['results'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'categorize_items' } },
      }),
    });
    if (resp.status === 429 || resp.status === 402 || !resp.ok) return null;
    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return null;
    const args = JSON.parse(toolCall.function.arguments);
    return Array.isArray(args.results) ? args.results : null;
  } catch (e) { console.error("auto-categorize Lovable failed:", e); return null; }
}

// 3. OpenRouter
async function tryOpenRouter(items: any[], context: string | undefined): Promise<any[] | null> {
  const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
  if (!OPENROUTER_API_KEY) return null;
  const { sys, user } = buildPrompt(items, context);
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
      }),
    });
    if (resp.status === 429 || resp.status === 402 || !resp.ok) return null;
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    return parseResults(text);
  } catch (e) { console.error("auto-categorize OpenRouter failed:", e); return null; }
}

// 4. Workers externos (não-stream, pegamos a resposta inteira e parseamos)
async function tryWorkers(items: any[], context: string | undefined, workers: AiWorker[], supabase: any): Promise<any[] | null> {
  const { sys, user } = buildPrompt(items, context);
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: user }],
          systemPrompt: sys,
          tenantName: "Categorizer",
          niche: "categorização",
        }),
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        }
        continue;
      }
      if (!response.ok) continue;
      // Lê o stream SSE inteiro e concatena o texto
      const reader = response.body!.getReader();
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
          } catch {}
        }
      }
      const results = parseResults(fullText);
      if (results) {
        if (worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", worker.id);
        } else {
          await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
        }
        return results;
      }
    } catch (e) { console.error(`auto-categorize worker ${worker.id} failed:`, e); continue; }
  }
  return null;
}

export async function auto_categorize(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { items, context } = await req.json();
    if (!Array.isArray(items) || items.length === 0) {
      return respond({ ok: false, error: 'items vazio' });
    }

    const supabase = getSupabaseAdmin();
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    // 1. Google
    let results = await tryGoogle(items, context, keys, supabase);
    if (results) return respond({ ok: true, results, provider: 'google' });

    // 2. Lovable
    console.log("auto-categorize: Google falhou, tentando Lovable...");
    results = await tryLovable(items, context);
    if (results) return respond({ ok: true, results, provider: 'lovable' });

    // 3. OpenRouter
    console.log("auto-categorize: Lovable falhou, tentando OpenRouter...");
    results = await tryOpenRouter(items, context);
    if (results) return respond({ ok: true, results, provider: 'openrouter' });

    // 4. Workers
    console.log("auto-categorize: OpenRouter falhou, tentando workers...");
    results = await tryWorkers(items, context, workers, supabase);
    if (results) return respond({ ok: true, results, provider: 'worker' });

    return respond({ ok: false, error: 'Todos os provedores de IA estão indisponíveis ou sem crédito agora. Tenta de novo em alguns minutos.' });
  } catch (e) {
    console.error('auto-categorize error', e);
    return respond({ ok: false, error: e instanceof Error ? e.message : 'Erro' });
  }

  } catch (e) {
    console.error("[unified:auto-categorize] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
