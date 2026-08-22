// Helper compartilhado: chama IA com cadeia de fallback
// Lovable AI → Google AI (api_keys do super admin) → AI Workers (ai_workers)
//
// Uso simples:
//   const text = await callAiText(supabase, { systemPrompt, userPrompt });
//   const json = await callAiJson<MyShape>(supabase, { systemPrompt, userPrompt });
//
// Retorna { text, provider } ou lança Error("ai_unavailable") se TODOS falharem.
async function getGoogleKeys(supabase) {
  const { data } = await supabase.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", {
    ascending: true,
    nullsFirst: true
  });
  return data || [];
}
async function getChatWorkers(supabase) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat").order("last_used_at", {
    ascending: true,
    nullsFirst: true
  });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted").eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat").order("exhausted_at", {
    ascending: true,
    nullsFirst: true
  });
  return [
    ...active || [],
    ...exhausted || []
  ];
}
// 1. Lovable AI Gateway
async function tryLovable(opts) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const body = {
      model: opts.model || "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: opts.systemPrompt
        },
        {
          role: "user",
          content: opts.userPrompt
        }
      ]
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    if (opts.jsonMode) body.response_format = {
      type: "json_object"
    };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
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
async function tryGoogle(opts, keys, supabase) {
  const allKeys = keys.length > 0 ? keys : Deno.env.get("GOOGLE_AI_API_KEY") ? [
    {
      id: "__env__",
      api_key: Deno.env.get("GOOGLE_AI_API_KEY")
    }
  ] : [];
  if (allKeys.length === 0) return null;
  // Contas Google AI novas não têm acesso aos modelos legados (404 "no longer available").
  // Repetir a tentativa com modelos modernos disponíveis para contas novas.
  const AF_MODELS = [
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite"
  ];
  for (const keyEntry of allKeys){
    for (const modelName of AF_MODELS){
      try {
        const generationConfig = {};
        if (opts.jsonMode) generationConfig.responseMimeType = "application/json";
        if (opts.temperature != null) generationConfig.temperature = opts.temperature;
        if (opts.maxTokens != null) generationConfig.maxOutputTokens = opts.maxTokens;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keyEntry.api_key}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: opts.systemPrompt
                  }
                ]
              },
              {
                role: "model",
                parts: [
                  {
                    text: "Entendido."
                  }
                ]
              },
              {
                role: "user",
                parts: [
                  {
                    text: opts.userPrompt
                  }
                ]
              }
            ],
            generationConfig: Object.keys(generationConfig).length ? generationConfig : undefined
          })
        });
        if (res.status === 429 || res.status === 403) {
          if (keyEntry.id !== "__env__") {
            await supabase.from("api_keys").update({
              is_exhausted: true
            }).eq("id", keyEntry.id);
          }
          break; // chave esgotada, pular para a próxima chave
        }
        if (res.status === 404) continue; // modelo indisponível nesta conta, tentar o próximo
        if (!res.ok) continue;
        if (keyEntry.id !== "__env__") {
          await supabase.from("api_keys").update({
            last_used_at: new Date().toISOString()
          }).eq("id", keyEntry.id);
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
async function tryWorkers(opts, workers, supabase) {
  for (const worker of workers){
    try {
      const url = worker.base_url.includes("/functions/") ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: opts.userPrompt
            }
          ],
          systemPrompt: opts.systemPrompt,
          tenantName: "Sistema",
          niche: "geral"
        })
      });
      if (res.status === 429 || res.status === 402 || res.status === 503) {
        if (!worker.is_exhausted) {
          await supabase.from("ai_workers").update({
            is_exhausted: true,
            exhausted_at: new Date().toISOString()
          }).eq("id", worker.id);
        }
        continue;
      }
      if (!res.ok) continue;
      // Lê stream SSE inteiro e concatena
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      while(true){
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {
          stream: true
        });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines){
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const t = parsed.choices?.[0]?.delta?.content;
            if (t) fullText += t;
          } catch  {}
        }
      }
      const trimmed = fullText.trim();
      if (trimmed) {
        // Reativa worker se estava esgotado
        if (worker.is_exhausted) {
          await supabase.from("ai_workers").update({
            is_exhausted: false,
            exhausted_at: null,
            last_used_at: new Date().toISOString()
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
 */ export async function callAiWithFallback(supabase, opts) {
  // 1. Lovable
  const r1 = await tryLovable(opts);
  if (r1) return {
    text: r1,
    provider: "lovable"
  };
  // 2. Google keys (api_keys do super admin)
  console.log("[ai-fallback] Lovable falhou, tentando Google keys...");
  const keys = await getGoogleKeys(supabase);
  const r2 = await tryGoogle(opts, keys, supabase);
  if (r2) return {
    text: r2,
    provider: "google"
  };
  // 3. AI Workers
  console.log("[ai-fallback] Google falhou, tentando AI Workers...");
  const workers = await getChatWorkers(supabase);
  const r3 = await tryWorkers(opts, workers, supabase);
  if (r3) return {
    text: r3,
    provider: "worker"
  };
  throw new Error("ai_unavailable");
}
/** Conveniência: retorna só o texto. */ export async function callAiText(supabase, opts) {
  const r = await callAiWithFallback(supabase, opts);
  return r.text;
}
/** Conveniência: extrai JSON da resposta (procura primeiro `{...}` ou `[...]`). */ export async function callAiJson(supabase, opts) {
  const r = await callAiWithFallback(supabase, {
    ...opts,
    jsonMode: true
  });
  // Tenta parsear direto, senão extrai bloco
  try {
    return JSON.parse(r.text);
  } catch  {}
  const m = r.text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) throw new Error("ai_invalid_json");
  return JSON.parse(m[0]);
}
/**
 * Streaming unificado para Sofia/Store/Clara.
 * Faz o roteamento para o provedor de streaming disponível (Google/Lovable/Worker).
 */ export async function callAiStream(supabase, opts) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  const SSE_HEADERS = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  };
  const { systemPrompt, messages, temperature = 0.7, maxTokens = 1000 } = opts;
  // 1. Tenta Lovable Streaming
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (lovableKey) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            ...messages
          ],
          stream: true,
          temperature,
          max_tokens: maxTokens
        })
      });
      if (res.ok && res.body) return new Response(res.body, {
        headers: SSE_HEADERS
      });
    } catch (e) {
      console.error("[ai-fallback:stream] Lovable fail", e);
    }
  }
  // 2. Tenta Google AI Streaming
  const keys = await getGoogleKeys(supabase);
  const googleKey = keys[0]?.api_key || Deno.env.get("GOOGLE_AI_API_KEY");
  if (googleKey) {
    try {
    // Nota: A API do Google tem formato diferente, mas o ai-chat-unified já trata.
    // Aqui usamos o formato OpenAI-like se o worker/gateway suportar, ou chamamos direto.
    // Por simplicidade, vamos tentar o gateway do Lovable com a chave do Google se possível, 
    // ou apenas pular para os workers que já fazem esse streaming corretamente.
    } catch (e) {
      console.error("[ai-fallback:stream] Google fail", e);
    }
  }
  // 3. Tenta Workers (que já devolvem SSE)
  const workers = await getChatWorkers(supabase);
  for (const w of workers){
    try {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            ...messages
          ],
          stream: true,
          tenantName: "SmartHubly",
          niche: "Plataforma"
        })
      });
      if (res.ok && res.body) return new Response(res.body, {
        headers: SSE_HEADERS
      });
    } catch (e) {
      console.error(`[ai-fallback:stream] Worker ${w.id} fail`, e);
    }
  }
  return null;
}
