import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

const SYSTEM_PROMPT = (niche?: string) => `Você é um copywriter especialista em promoções para lojas de delivery. 
Reescreva o texto da promoção de forma mais atrativa, persuasiva e comercial. 
Mantenha curto (máximo 2 frases). Use emojis com moderação.
${niche ? `O nicho da loja é: ${niche}` : ''}
Responda APENAS com o texto refinado, sem explicações.`;

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

// Provider 1: Google AI
async function tryGoogle(text: string, niche: string, keys: ApiKeyEntry[], supabase: any): Promise<string | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];

  for (const keyEntry of allKeys) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keyEntry.api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ text: SYSTEM_PROMPT(niche) }] },
              { role: "model", parts: [{ text: "Entendido!" }] },
              { role: "user", parts: [{ text }] },
            ],
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
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (e) { console.error("Google attempt failed:", e); continue; }
  }
  return null;
}

// Provider 2: Lovable AI Gateway
async function tryLovable(text: string, niche: string): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: SYSTEM_PROMPT(niche) }, { role: "user", content: text }],
      }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// Provider 3: OpenRouter
async function tryOpenRouter(text: string, niche: string): Promise<string | null> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "system", content: SYSTEM_PROMPT(niche) }, { role: "user", content: text }],
      }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// Provider 4: External AI Workers
async function tryWorkers(text: string, niche: string, workers: AiWorker[], supabase: any): Promise<string | null> {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: text }],
          systemPrompt: SYSTEM_PROMPT(niche),
          tenantName: "refine-promo",
          niche: niche || "",
        }),
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        }
        continue;
      }
      if (!response.ok) continue;

      if (worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", worker.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", worker.id);
      }

      // Worker retorna SSE stream, precisamos extrair o texto completo
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let result = "";
      let buffer = "";
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
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) result += content;
          } catch {}
        }
      }
      if (result) return result;
    } catch (e) { console.error(`Worker ${worker.id} failed:`, e); continue; }
  }
  return null;
}

export async function refine(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, niche } = await req.json();
    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: "Texto vazio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    // 1. Google
    const r1 = await tryGoogle(text, niche || "", keys, supabase);
    if (r1) return new Response(JSON.stringify({ refined: r1 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 2. Lovable
    console.log("Google failed, trying Lovable AI...");
    const r2 = await tryLovable(text, niche || "");
    if (r2) return new Response(JSON.stringify({ refined: r2 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 3. OpenRouter
    console.log("Lovable failed, trying OpenRouter...");
    const r3 = await tryOpenRouter(text, niche || "");
    if (r3) return new Response(JSON.stringify({ refined: r3 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 4. Workers
    console.log("OpenRouter failed, trying AI workers...");
    const r4 = await tryWorkers(text, niche || "", workers, supabase);
    if (r4) return new Response(JSON.stringify({ refined: r4 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ error: "Todos os provedores de IA falharam." }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("refine-promo error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  } catch (e) {
    console.error("[unified:refine] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
