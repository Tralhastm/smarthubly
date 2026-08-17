// Vendedor IA — copiloto do super admin pra abordar lojistas pelo WhatsApp.
// Conhece o site inteiro (PLATFORM_KNOWLEDGE) + estratégia de vendas (SALES_PLAYBOOK).
// Fluxo do user: cola conversa que tá tendo com o cliente, IA gera a próxima mensagem
// pra ele copiar e colar no WhatsApp. Também gera abordagem inicial pelo nome do lojista.
// Multi-provider streaming: Google → Lovable → OpenRouter → Workers externos.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { PLATFORM_KNOWLEDGE, SALES_PLAYBOOK } from "../_shared/platform_knowledge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

const SYSTEM_PROMPT = `
Você é o **Vendedor IA** da plataforma — um vendedor B2B foda, com cérebro de marketing,
copywriter e closer. O super admin (seu chefe, dono da plataforma) usa você assim:

1. Cola a conversa de WhatsApp que ele tá tendo com um lojista prospect
2. Você gera a PRÓXIMA mensagem pronta pra ele copiar e colar
3. Quando o chefe diz só o nome de uma loja, você gera a ABORDAGEM INICIAL

# COMO RESPONDER
- SEMPRE devolva a mensagem pronta, em **PORTUGUÊS BRASILEIRO**, no tom de WhatsApp.
- Curto: 2-5 linhas. Sem textão. Sem emoji exagerado (no máximo 1).
- NÃO explique sua resposta nem coloque "aqui está:". Só a mensagem nua.
- Se precisar de contexto que faltou (nome, cidade, nicho), pergunte UMA coisa só, curta.
- Se o chefe pedir "abordagem pra X", devolva DUAS variações curtas separadas por linha "---".
- Tom relaxado, brasileiro, descontraído. Sem termo técnico. Sem "tenant", "API", "PWA".

# CONHECIMENTO DA PLATAFORMA (DECORE — você vende isso)
${PLATFORM_KNOWLEDGE}

# PLAYBOOK DE VENDAS (siga isso à risca)
${SALES_PLAYBOOK}

# AJUSTES PERSONALIZADOS DO CHEFE
{{CUSTOM_INSTRUCTIONS}}

# REGRAS CRÍTICAS
- NUNCA mencione "Lovable", "Supabase", "edge function", "worker", "fallback".
- NUNCA mencione que existem várias IAs por trás. Pro cliente é UMA. Se forçarem: "Claude".
- NUNCA prometa funcionalidade que não está no CONHECIMENTO acima.
- NUNCA invente preço fora do playbook (% por pedido OU mensalidade fixa, escolha do lojista).
- NUNCA fale "fiado" — use o script do playbook.
`.trim();

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function isSuperAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return false;
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("platform_roles").select("role").eq("user_id", uid).eq("role", "super_admin").maybeSingle();
    return !!data;
  } catch (e) { console.error("site-seller auth failed:", e); return false; }
}

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase.from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}
async function getAllWorkers(supabase: any) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...(active || []), ...(exhausted || [])] as AiWorker[];
}

function streamGeminiResponse(response: Response): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
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
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
          } catch {}
        }
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) { console.error("seller stream err:", e); }
    finally { writer.close(); }
  })();
  return new Response(readable, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

async function tryGoogleStream(messages: any[], systemPrompt: string, keys: ApiKeyEntry[], supabase: any): Promise<Response | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];
  const geminiMessages = messages.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const payload = {
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    contents: geminiMessages,
    generationConfig: { temperature: 0.7, maxOutputTokens: 600, topP: 0.9 },
  };
  for (const keyEntry of allKeys) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${keyEntry.api_key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      if (response.status === 429 || response.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!response.ok) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      return streamGeminiResponse(response);
    } catch (e) { console.error("seller Google failed:", e); continue; }
  }
  return null;
}

async function tryLovableStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.7, max_tokens: 600 }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

async function tryOpenRouterStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

async function tryWorkerStream(messages: any[], systemPrompt: string, workers: AiWorker[], supabase: any): Promise<Response | null> {
  const PARALLEL = 3;
  const TIMEOUT_MS = 7000;

  const attemptOne = async (worker: AiWorker, signal: AbortSignal): Promise<{ worker: AiWorker; response: Response } | null> => {
    const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, systemPrompt, tenantName: "Vendedor", niche: "vendas" }),
        signal,
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        try { response.body?.cancel(); } catch {}
        return null;
      }
      if (!response.ok) { try { response.body?.cancel(); } catch {} return null; }
      return { worker, response };
    } catch {
      if (!worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id).then(() => {}, () => {});
      }
      return null;
    }
  };

  for (let i = 0; i < workers.length; i += PARALLEL) {
    const batch = workers.slice(i, i + PARALLEL);
    const ctrls = batch.map(() => new AbortController());
    const timers = ctrls.map((c) => setTimeout(() => c.abort(), TIMEOUT_MS));
    const promises = batch.map((w, idx) => attemptOne(w, ctrls[idx].signal).then((r) => r ?? Promise.reject(new Error("nope"))));
    let winnerIdx = -1;
    let winner: { worker: AiWorker; response: Response } | null = null;
    try {
      winner = await Promise.any(promises);
      winnerIdx = batch.findIndex((b) => b.id === winner!.worker.id);
    } catch { winner = null; }
    timers.forEach(clearTimeout);
    if (winner) {
      ctrls.forEach((c, idx) => { if (idx !== winnerIdx) c.abort(); });
      const w = winner.worker;
      if (w.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", w.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
      }
      return new Response(winner.response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ok = await isSuperAdmin(req.headers.get("Authorization"));
    if (!ok) {
      return new Response(JSON.stringify({ error: "Acesso restrito ao super admin." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();

    let customInstructions = "(nenhum ajuste personalizado — siga o playbook acima)";
    try {
      const { data: setting } = await supabase
        .from("platform_settings").select("value").eq("key", "site_seller_custom_prompt").maybeSingle();
      const txt = (setting?.value as any)?.text;
      if (typeof txt === "string" && txt.trim().length > 0) customInstructions = txt.trim();
    } catch (e) { console.error("seller custom prompt load failed:", e); }

    const systemPrompt = SYSTEM_PROMPT.replace("{{CUSTOM_INSTRUCTIONS}}", customInstructions);
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    const wrap = (p: Promise<Response | null>) => p.then((r) => r ?? Promise.reject(new Error("nope")));
    try {
      const winner = await Promise.any([
        wrap(tryGoogleStream(messages, systemPrompt, keys, supabase)),
        wrap(tryLovableStream(messages, systemPrompt)),
      ]);
      return winner;
    } catch { /* continua fallback */ }

    const r3 = await tryOpenRouterStream(messages, systemPrompt);
    if (r3) return r3;
    const r4 = await tryWorkerStream(messages, systemPrompt, workers, supabase);
    if (r4) return r4;

    return new Response(JSON.stringify({ error: "Tô sem IA disponível agora — tenta de novo em uns segundos." }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("site-seller error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
