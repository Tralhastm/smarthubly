import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const SSE_HEADERS = {
  ...corsHeaders,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
};
function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
}
function buildSystemPrompt(businessData) {
  const data = businessData || {};
  const fmt = (n)=>typeof n === "number" ? `R$ ${n.toFixed(2).replace(".", ",")}` : "—";
  const topProducts = Array.isArray(data.topProducts) && data.topProducts.length ? data.topProducts.slice(0, 5).map((p, i)=>`  ${i + 1}. ${p.name} — ${p.sales || 0} vendas — ${fmt(p.revenue)}`).join("\n") : "  (sem dados de vendas ainda)";
  return `Você é Clara, consultora financeira empresarial sênior. Direta, didática, estratégica. Fala português brasileiro natural, sem jargão técnico.

SEU PAPEL:
- Analisar a saúde financeira do negócio do usuário com base nos DADOS REAIS abaixo.
- Sugerir estratégias práticas pra aumentar lucro, reduzir custo, recuperar inadimplência, criar combos, melhorar ticket médio.
- Explicar conceitos (margem, ponto de equilíbrio, capital de giro, fluxo de caixa) de jeito que qualquer dono de pequeno negócio entenda.
- Quando o usuário pedir, ensinar a usar o sistema (importar produtos via TXT/XML, lançar despesa, marcar fiado, gerar relatório).

REGRAS:
- NUNCA invente números. Use APENAS o que vier nos dados abaixo.
- Se faltar dado, peça ao usuário ou diga "ainda não tenho esse dado".
- Respostas curtas e acionáveis. Use bullets quando ajudar.
- Em valores, sempre formato R$ X,XX.
- Tom: parceira de negócio, nunca arrogante. Pode usar emojis ocasionais (📊 💰 ⚠️).

DADOS DO NEGÓCIO (use SEMPRE estes valores, não invente outros):
- Faturamento mensal: ${fmt(data.monthlyRevenue)}
- Despesas mensais: ${fmt(data.monthlyExpenses)}
- Lucro bruto estimado: ${typeof data.monthlyRevenue === "number" && typeof data.monthlyExpenses === "number" ? fmt(data.monthlyRevenue - data.monthlyExpenses) : "—"}
- Total de clientes: ${data.totalCustomers ?? "—"}
- Ticket médio: ${fmt(data.averageTicket)}
- Inadimplentes (fiado em aberto): ${data.badDebtors ?? "—"}
- Crescimento vs mês anterior: ${typeof data.growthRate === "number" ? `${data.growthRate.toFixed(1)}%` : "—"}

TOP PRODUTOS:
${topProducts}`;
}
async function getGoogleKeys(supabase) {
  const { data } = await supabase.from("api_keys").select("id, api_key").eq("provider", "google_ai").eq("is_exhausted", false).order("last_used_at", {
    ascending: true,
    nullsFirst: true
  });
  return data || [];
}
async function getAiWorkers(supabase) {
  const { data } = await supabase.from("ai_workers").select("id, base_url").eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat").order("last_used_at", {
    ascending: true,
    nullsFirst: true
  });
  return data || [];
}
// Converte stream do Google Gemini para SSE no formato OpenAI
function googleToOpenAIStream(googleStream) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  return new ReadableStream({
    async start (controller) {
      const reader = googleStream.getReader();
      try {
        while(true){
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, {
            stream: true
          });
          // Google envia JSON arrays separados por linha
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (let line of lines){
            line = line.trim();
            if (!line || line === "[" || line === "]" || line === ",") continue;
            if (line.startsWith(",")) line = line.slice(1);
            try {
              const obj = JSON.parse(line);
              const text = obj.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (text) {
                const sse = `data: ${JSON.stringify({
                  choices: [
                    {
                      delta: {
                        content: text
                      }
                    }
                  ]
                })}\n\n`;
                controller.enqueue(encoder.encode(sse));
              }
            } catch  {}
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });
}
async function tryGoogleStream(systemPrompt, messages, keys, supabase) {
  const allKeys = keys.length > 0 ? keys : Deno.env.get("GOOGLE_AI_API_KEY") ? [
    {
      id: "__env__",
      api_key: Deno.env.get("GOOGLE_AI_API_KEY")
    }
  ] : [];
  for (const keyEntry of allKeys){
    try {
      const contents = messages.map((m)=>({
          role: m.role === "assistant" ? "model" : "user",
          parts: [
            {
              text: m.content
            }
          ]
        }));
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=${keyEntry.api_key}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: systemPrompt
              }
            ]
          },
          contents
        })
      });
      if (response.status === 429 || response.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({
          is_exhausted: true
        }).eq("id", keyEntry.id);
        continue;
      }
      if (!response.ok || !response.body) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({
        last_used_at: new Date().toISOString()
      }).eq("id", keyEntry.id);
      const stream = googleToOpenAIStream(response.body);
      return new Response(stream, {
        headers: SSE_HEADERS
      });
    } catch (e) {
      console.error("Google stream failed:", e);
      continue;
    }
  }
  return null;
}
async function tryLovableStream(systemPrompt, messages) {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...messages
        ],
        stream: true
      })
    });
    if (!response.ok || !response.body) return null;
    return new Response(response.body, {
      headers: SSE_HEADERS
    });
  } catch  {
    return null;
  }
}
async function tryOpenRouterStream(systemPrompt, messages) {
  const KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...messages
        ],
        stream: true
      })
    });
    if (!response.ok || !response.body) return null;
    return new Response(response.body, {
      headers: SSE_HEADERS
    });
  } catch  {
    return null;
  }
}
async function tryWorkerStream(systemPrompt, messages, workers, supabase) {
  for (const worker of workers){
    try {
      const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
      const response = await fetch(url, {
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
          stream: true
        })
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        await supabase.from("ai_workers").update({
          is_exhausted: true,
          exhausted_at: new Date().toISOString()
        }).eq("id", worker.id);
        continue;
      }
      if (!response.ok || !response.body) continue;
      await supabase.from("ai_workers").update({
        last_used_at: new Date().toISOString()
      }).eq("id", worker.id);
      return new Response(response.body, {
        headers: SSE_HEADERS
      });
    } catch  {
      continue;
    }
  }
  return null;
}
export async function financial(req, body) {
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed = body ?? (ct.includes("application/json") ? await req.json().catch(()=>({})) : {});
    const { messages, businessData } = parsed;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({
        error: "messages é obrigatório"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const systemPrompt = buildSystemPrompt(businessData);
    const supabase = getSupabaseAdmin();
    const [keys, workers] = await Promise.all([
      getGoogleKeys(supabase),
      getAiWorkers(supabase)
    ]);
    // Cascata de streaming
    const r1 = await tryGoogleStream(systemPrompt, messages, keys, supabase);
    if (r1) return r1;
    const r2 = await tryLovableStream(systemPrompt, messages);
    if (r2) return r2;
    const r3 = await tryOpenRouterStream(systemPrompt, messages);
    if (r3) return r3;
    const r4 = await tryWorkerStream(systemPrompt, messages, workers, supabase);
    if (r4) return r4;
    return new Response(JSON.stringify({
      error: "Limite de uso atingido em todos os provedores. Tente novamente em alguns minutos."
    }), {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error("[unified:financial] error", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : String(e)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
