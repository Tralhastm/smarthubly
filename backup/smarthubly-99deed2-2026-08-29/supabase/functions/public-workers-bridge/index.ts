// Ponte pública para outros projetos Lovable usarem os workers de IA deste projeto.
//
// Autenticação: header `x-bridge-token: <WORKERS_BRIDGE_TOKEN>`
//
// GET  /?type=chat|txt|image   -> lista URLs de workers ativos (ordenados por menos usados)
// POST /                       -> proxy que executa a cadeia de fallback deste projeto
//   body: { mode: "text" | "json", systemPrompt, userPrompt, model?, temperature?, maxTokens? }
//   resp: { text?: string, data?: any, provider: "lovable"|"google"|"worker" }
//
// Assim, o outro projeto Lovable NÃO precisa recriar a lógica de fallback:
// basta chamar POST aqui e recebe a resposta já pronta, consumindo os workers
// cadastrados neste projeto (incluindo os novos que forem sendo adicionados).

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiWithFallback, callAiJson } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bridge-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("WORKERS_BRIDGE_TOKEN");
  if (!expected) return json({ error: "bridge_not_configured" }, 500);

  const provided = req.headers.get("x-bridge-token");
  if (!provided || provided !== expected) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const type = url.searchParams.get("type") || "chat";
      if (!["chat", "txt", "image"].includes(type)) {
        return json({ error: "invalid_type" }, 400);
      }
      const { data, error } = await supabase
        .from("ai_workers")
        .select("id, name, base_url, worker_type, is_exhausted, last_used_at")
        .eq("is_active", true)
        .eq("worker_type", type)
        .order("is_exhausted", { ascending: true })
        .order("last_used_at", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return json({ workers: data || [] });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const {
        mode = "text",
        systemPrompt = "",
        userPrompt = "",
        model,
        temperature,
        maxTokens,
      } = body || {};

      if (!userPrompt || typeof userPrompt !== "string") {
        return json({ error: "userPrompt_required" }, 400);
      }

      if (mode === "json") {
        const data = await callAiJson(supabase, {
          systemPrompt,
          userPrompt,
          model,
          temperature,
          maxTokens,
        });
        return json({ data, provider: "chain" });
      }

      const result = await callAiWithFallback(supabase, {
        systemPrompt,
        userPrompt,
        model,
        temperature,
        maxTokens,
      });
      return json(result);
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (e: any) {
    console.error("[public-workers-bridge] erro:", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
