import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mensagem barata: 1 token de saída no modelo mais barato
const TEST_BODY = {
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  generationConfig: { maxOutputTokens: 1, temperature: 0 },
};

// Contas Google AI novas não têm acesso aos modelos legados (404). Testa uma cadeia de modelos.
const HC_MODELS = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
async function testGoogleKey(apiKey: string): Promise<{ ok: boolean; status: number }> {
  try {
    let lastStatus = 0;
    for (const model of HC_MODELS) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(TEST_BODY) }
      );
      lastStatus = res.status;
      await res.text();
      if (res.status === 404) continue; // modelo legado indisponível nesta conta, tentar o próximo
      return { ok: res.ok, status: res.status };
    }
    return { ok: lastStatus >= 200 && lastStatus < 300, status: lastStatus };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function testWorker(baseUrl: string): Promise<{ ok: boolean; status: number }> {
  try {
    // base_url já vem completo (ex: https://xxx.supabase.co/functions/v1/ai-chat)
    // Se faltar /functions/v1/ai-chat, adiciona
    const url = baseUrl.includes("/functions/")
      ? baseUrl
      : baseUrl.replace(/\/$/, "") + "/functions/v1/ai-chat";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: "Responda apenas: ok",
        tenantName: "Health Check",
        niche: "geral",
      }),
    });
    await res.text();
    // 2xx = vivo. 400 = recebeu mas request inválido (ainda vivo).
    // 402/429/503 = rate-limited (mantém esgotado). 5xx/404 = offline.
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    if (res.status === 400) return { ok: true, status: res.status };
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results = {
    keys_tested: 0,
    keys_revived: 0,
    workers_tested: 0,
    workers_revived: 0,
    details: [] as any[],
  };

  // 1) API keys exauridas
  const { data: exhaustedKeys } = await supabase
    .from("api_keys")
    .select("id, api_key, provider")
    .eq("is_exhausted", true);

  for (const key of exhaustedKeys || []) {
    results.keys_tested++;
    const { ok, status } = await testGoogleKey(key.api_key);
    if (ok) {
      await supabase
        .from("api_keys")
        .update({ is_exhausted: false, last_used_at: new Date().toISOString() })
        .eq("id", key.id);
      results.keys_revived++;
      results.details.push({ type: "key", id: key.id, revived: true, status });
    } else {
      results.details.push({ type: "key", id: key.id, revived: false, status });
    }
  }

  // 2) AI Workers exauridos
  const { data: exhaustedWorkers } = await supabase
    .from("ai_workers")
    .select("id, base_url")
    .eq("is_active", true)
    .eq("is_exhausted", true);

  for (const worker of exhaustedWorkers || []) {
    results.workers_tested++;
    const { ok, status } = await testWorker(worker.base_url);
    if (ok) {
      await supabase
        .from("ai_workers")
        .update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() })
        .eq("id", worker.id);
      results.workers_revived++;
      results.details.push({ type: "worker", id: worker.id, revived: true, status });
    } else {
      results.details.push({ type: "worker", id: worker.id, revived: false, status });
    }
  }

  console.log("Health check:", JSON.stringify(results));

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
