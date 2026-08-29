// Helper compartilhado: chama IA com cadeia de fallback
// Lovable AI → Google AI (api_keys do super admin) → AI Workers (ai_workers)

export interface AiCallOptions {
  systemPrompt: string;
  userPrompt?: string;
  messages?: any[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  stream?: boolean;
}

export interface AiResult {
  text: string;
  provider: string;
}

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase.from("api_keys")
    .select("id, api_key")
    .eq("provider", "google_ai")
    .eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return data || [];
}

async function getChatWorkers(supabase: any) {
  const { data: active } = await supabase.from("ai_workers")
    .select("id, base_url, is_exhausted")
    .eq("is_active", true)
    .eq("is_exhausted", false)
    .eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  
  const { data: exhausted } = await supabase.from("ai_workers")
    .select("id, base_url, is_exhausted")
    .eq("is_active", true)
    .eq("is_exhausted", true)
    .eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });

  return [...(active || []), ...(exhausted || [])];
}

// 1. Lovable AI Gateway
async function tryLovable(opts: AiCallOptions) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  
  try {
    const body: any = {
      model: opts.model || "google/gemini-2.0-flash",
      messages: opts.messages || [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt }
      ]
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    if (opts.jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (res.status === 429 || res.status === 402 || !res.ok) {
      console.log(`[ai-fallback] Lovable falhou: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content || "").trim() || null;
  } catch (e) {
    console.error("[ai-fallback] Lovable exception:", e);
    return null;
  }
}

// 2. Google AI direto
async function tryGoogle(opts: AiCallOptions, keys: any[], supabase: any) {
  const allKeys = keys.length > 0 ? keys : (Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY") }] : []);
  if (allKeys.length === 0) return null;

  const AF_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];

  for (const keyEntry of allKeys) {
    for (const modelName of AF_MODELS) {
      try {
        const generationConfig: any = {};
        if (opts.jsonMode) generationConfig.responseMimeType = "application/json";
        if (opts.temperature != null) generationConfig.temperature = opts.temperature;
        if (opts.maxTokens != null) generationConfig.maxOutputTokens = opts.maxTokens;

        const contents = opts.messages ? 
          opts.messages.map((m: any) => ({ 
            role: m.role === "assistant" ? "model" : "user", 
            parts: [{ text: m.content }] 
          })) : 
          [
            { role: "user", parts: [{ text: opts.systemPrompt }] },
            { role: "model", parts: [{ text: "Entendido." }] },
            { role: "user", parts: [{ text: opts.userPrompt }] }
          ];

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keyEntry.api_key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, generationConfig })
        });

        if (res.status === 429 || res.status === 403) {
          if (keyEntry.id !== "__env__") {
            await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
          }
          break; 
        }
        if (!res.ok) continue;

        if (keyEntry.id !== "__env__") {
          await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
        }

        const data = await res.json();
        return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim() || null;
      } catch (e) {
        console.error(`[ai-fallback] Google exception (${modelName}):`, e);
        continue;
      }
    }
  }
  return null;
}

// 3. AI Workers
async function tryWorkers(opts: AiCallOptions, workers: any[], supabase: any) {
  for (const worker of workers) {
    try {
      const url = worker.base_url.includes("/functions/") ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: opts.messages || [{ role: "user", content: opts.userPrompt }],
          systemPrompt: opts.systemPrompt,
          tenantName: "Sistema",
          niche: "geral"
        })
      });

      if (res.status === 429 || res.status === 402 || res.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        }
        continue;
      }
      if (!res.ok) continue;

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
          } catch {}
        }
      }

      const trimmed = fullText.trim();
      if (trimmed) {
        await supabase.from("ai_workers").update({ 
          is_exhausted: false, 
          exhausted_at: null, 
          last_used_at: new Date().toISOString() 
        }).eq("id", worker.id);
        return trimmed;
      }
    } catch (e) {
      console.error(`[ai-fallback] Worker ${worker.id} exception:`, e);
      continue;
    }
  }
  return null;
}

export async function callAiWithFallback(supabase: any, opts: AiCallOptions): Promise<AiResult> {
  const r1 = await tryLovable(opts);
  if (r1) return { text: r1, provider: "lovable" };

  const keys = await getGoogleKeys(supabase);
  const r2 = await tryGoogle(opts, keys, supabase);
  if (r2) return { text: r2, provider: "google" };

  const workers = await getChatWorkers(supabase);
  const r3 = await tryWorkers(opts, workers, supabase);
  if (r3) return { text: r3, provider: "worker" };

  throw new Error("ai_unavailable");
}

export async function callAiText(supabase: any, opts: AiCallOptions): Promise<string> {
  const r = await callAiWithFallback(supabase, opts);
  return r.text;
}

export async function callAiJson<T = any>(supabase: any, opts: AiCallOptions): Promise<T> {
  const r = await callAiWithFallback(supabase, { ...opts, jsonMode: true });
  try {
    return JSON.parse(r.text);
  } catch {}
  const m = r.text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) throw new Error("ai_invalid_json");
  return JSON.parse(m[0]);
}

export async function _callAiJson<T = any>(supabase: any, opts: AiCallOptions): Promise<T> {
  return callAiJson(supabase, opts);
}

export async function _callAiVisionJson<T = any>(supabase: any, opts: any): Promise<T> {
  // Vision logic delegada para o fallback se suportado ou erro
  return callAiJson(supabase, { ...opts, model: "google/gemini-2.0-flash" });
}

export async function callAiStream(supabase: any, opts: AiCallOptions) {
  const { systemPrompt, messages = [], temperature = 0.7, maxTokens = 1000 } = opts;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  const SSE_HEADERS = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  };

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  
  // Tenta Lovable Stream primeiro
  if (lovableKey) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash",
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true, temperature, max_tokens: maxTokens
        })
      });
      if (res.ok && res.body) return new Response(res.body, { headers: SSE_HEADERS });
    } catch (e) {
      console.error("[ai-fallback:stream] Lovable fail:", e);
    }
  }

  // Fallback para Google Stream
  const keys = await getGoogleKeys(supabase);
  const googleKey = keys[0]?.api_key || Deno.env.get("GOOGLE_AI_API_KEY");
  if (googleKey) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${googleKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Entendido." }] },
            ...messages.map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
          ],
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        })
      });
      if (res.ok && res.body) {
        const transformStream = new TransformStream({
          transform(chunk, controller) {
            const text = new TextDecoder().decode(chunk);
            const lines = text.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (content) {
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                      choices: [{ delta: { content } }]
                    })}\n\n`));
                  }
                } catch {}
              }
            }
          },
          flush(controller) { controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); }
        });
        return new Response(res.body.pipeThrough(transformStream), { headers: SSE_HEADERS });
      }
    } catch (e) {
      console.error("[ai-fallback:stream] Google fail:", e);
    }
  }

  // Fallback para Workers
  const workers = await getChatWorkers(supabase);
  for (const w of workers) {
    try {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true, tenantName: "SmartHubly", niche: "Plataforma"
        })
      });
      if (res.ok && res.body) return new Response(res.body, { headers: SSE_HEADERS });
    } catch {}
  }

  return new Response("data: " + JSON.stringify({ error: "AI indisponível" }) + "\n\n", { headers: SSE_HEADERS });
}
