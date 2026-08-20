// Edge function: gera insights de gestão empresarial.
// Cadeia: Lovable AI → Google AI (api_keys) → AI Workers.
// Sem streaming — resposta única em JSON.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callAiJson } from "../../../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Snapshot = {
  storeName?: string;
  todaySales?: number;
  todayCount?: number;
  monthRevenue?: number;
  monthExpenses?: number;
  productsCount?: number;
  lowStockProducts?: string[];
  outOfStockCount?: number;
  fiadoOpen?: number;
  pendingOrdersValue?: number;
  cashOpen?: boolean;
  topProductMonth?: string | null;
  margin?: number;
};

type Insight = { type: "success" | "warning" | "danger" | "tip"; title: string; text: string };

export async function insights(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const snapshot = await req.json() as Snapshot;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const systemPrompt = `Você é a Clara, assistente empresarial de uma loja brasileira. Seu trabalho é olhar os números do negócio e dar 2 a 4 insights CURTOS e ACIONÁVEIS pro dono.

Regras:
- Tom direto, amigável, em português do Brasil.
- Cada insight tem 1 frase curta (máx 140 chars) com uma ação concreta.
- Use emojis no começo do título (ex: "📦", "💰", "⚠️", "🎯").
- Tipos: "success" (algo bom), "warning" (atenção), "danger" (urgente), "tip" (sugestão).
- NÃO invente números que não foram fornecidos.
- Se faltar dado pra um insight, simplesmente não gere ele.

RESPONDA APENAS com JSON válido neste formato exato (sem markdown, sem texto antes/depois):
{"insights":[{"type":"success|warning|danger|tip","title":"...","text":"..."}]}`;

    const userPrompt = `Snapshot do negócio agora:\n${JSON.stringify(snapshot, null, 2)}\n\nGere 2 a 4 insights no formato JSON pedido.`;

    try {
      const parsed = await callAiJson<{ insights?: Insight[] }>(supabase, {
        systemPrompt,
        userPrompt,
        temperature: 0.6,
        maxTokens: 600,
      });
      return new Response(JSON.stringify({ insights: parsed.insights ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ai_error";
      if (msg === "ai_unavailable") {
        return new Response(
          JSON.stringify({ error: "ai_unavailable", message: "🤖 IA indisponível agora. Tente em alguns minutos." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // JSON inválido — devolve lista vazia em vez de quebrar a UI
      console.error("empresarial-insights parse error:", msg);
      return new Response(JSON.stringify({ insights: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("empresarial-insights error:", e);
    return new Response(
      JSON.stringify({ error: "internal", message: e instanceof Error ? e.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  } catch (e) {
    console.error("[unified:insights] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
