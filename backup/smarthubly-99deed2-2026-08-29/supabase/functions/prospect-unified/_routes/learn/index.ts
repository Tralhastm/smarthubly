// Analisa uma conversa fechada/recusada e extrai lições para evoluir as próximas abordagens.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAiWithFallback } from "../../../_shared/ai-fallback.ts";
import { authorizeCaller, assertProspectAccess, type CallerAuth } from "../../../_shared/authorize-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYS = `Você é um analista sênior de vendas B2B via WhatsApp.
Recebe UMA conversa completa de prospecção (lead de restaurante/loja) e o RESULTADO (fechou ou recusou).
Sua missão: extrair APRENDIZADOS práticos para que a IA evolua nas próximas abordagens.

Devolva JSON estrito:
{
  "key_lesson": "1 frase curta e acionável — a lição central deste caso",
  "what_worked": "o que da abordagem gerou avanço (mesmo se recusou no fim). vazio se nada.",
  "what_failed": "o que afastou o lead, soou robótico, errou o ângulo. vazio se nada.",
  "pain_signals": ["dor1","dor2"]  // dores reais do lead detectadas no diálogo (curtas, em kebab-case PT)
}

Seja específico, sem genérico ("ser mais humano" NÃO serve). Aponte gatilhos concretos: ângulo da abertura, feature mencionada, tom, momento da pergunta, objeção que travou, etc.`;

export async function learn(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "no_auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const caller = await authorizeCaller(supabase, user.id);
    if ((caller as any).error) {
      const c = caller as { error: string; status: number };
      return new Response(JSON.stringify({ error: c.error }), { status: c.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const callerAuth = caller as CallerAuth;

    const { prospect_id, outcome } = await req.json() as { prospect_id: string; outcome: "won" | "lost" };
    if (!prospect_id || !["won", "lost"].includes(outcome)) {
      return new Response(JSON.stringify({ error: "params_invalid" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: prospect } = await supabase
      .from("remote_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!prospect) return new Response(JSON.stringify({ error: "prospect_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const access = assertProspectAccess(callerAuth, prospect);
    if ((access as any).error) {
      const a = access as { error: string; status: number };
      return new Response(JSON.stringify({ error: a.error }), { status: a.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const log = Array.isArray(prospect.conversation_log) ? prospect.conversation_log : [];
    if (log.length === 0) {
      return new Response(JSON.stringify({ ok: false, reason: "sem_conversa" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const transcript = log.map((m: any) => `${m.from === "me" ? "EU" : "LEAD"}: ${m.text}`).join("\n");
    const ctx = `LOJA: ${prospect.business_name}
NICHO: ${prospect.niche ?? "—"} | CATEGORIA: ${prospect.category ?? "—"}
CIDADE: ${prospect.city ?? ""}${prospect.state ? "/" + prospect.state : ""}
DORES DETECTADAS PRÉVIAS: ${(prospect.pain_signals ?? []).join(", ") || "—"}
RESULTADO: ${outcome === "won" ? "FECHOU ✓" : "RECUSOU ✗"}

CONVERSA COMPLETA:
${transcript}`;

    let parsed: any = null;
    try {
      const r = await callAiWithFallback(supabase, {
        systemPrompt: SYS, userPrompt: ctx, jsonMode: true, temperature: 0.3,
      });
      parsed = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] ?? r.text);
    } catch (e) {
      console.error("[prospect-learn] AI fail:", e);
      return new Response(JSON.stringify({ ok: false, reason: "ai_indisponivel" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const lesson = String(parsed?.key_lesson ?? "").trim();
    if (!lesson) {
      return new Response(JSON.stringify({ ok: false, reason: "sem_licao" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const excerpt = log.slice(-8); // últimas 8 msgs como evidência

    const { error: insErr } = await supabase.from("prospect_learnings").insert({
      prospect_id,
      outcome,
      niche: prospect.niche ?? null,
      pain_signals: Array.isArray(parsed?.pain_signals) ? parsed.pain_signals.slice(0, 8) : [],
      what_worked: String(parsed?.what_worked ?? "").trim(),
      what_failed: String(parsed?.what_failed ?? "").trim(),
      key_lesson: lesson,
      conversation_excerpt: excerpt,
      weight: outcome === "won" ? 2 : 1,
    });
    if (insErr) {
      console.error("[prospect-learn] insert fail:", insErr);
      return new Response(JSON.stringify({ ok: false, reason: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, lesson, outcome }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[prospect-learn] erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  } catch (e) {
    console.error("[unified:learn] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
