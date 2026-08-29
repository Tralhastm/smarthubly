// Analisa a conversa de um lead (Prospecção Mapa/Rua) e gera indicadores:
// - tags automáticas (aguardando_resposta, reuniao_marcada, frio, quente, etc.)
// - mensagem sugerida pra próxima abordagem com base no histórico
// - data de lembrete (reminder_at) quando faz sentido cobrar
// Preserva tags MANUAIS do operador. Só substitui as tags de origem "auto".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAiWithFallback } from "../_shared/ai-fallback.ts";
import { authorizeCaller, assertProspectAccess, type CallerAuth } from "../_shared/authorize-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYS = `Você é analista de pipeline de vendas (WhatsApp PT-BR).
Recebe: contexto do lojista + histórico colado + log de mensagens enviadas pelo sistema.
Devolve em JSON: tags (lista de marcadores), suggested_message (próxima ação sugerida pelo operador) e reminder_at (ISO 8601, opcional).

REGRAS DAS TAGS:
- Cada tag: { "label": "texto curto (até 30 chars)", "color": "red|yellow|green|blue|purple|gray", "kind": "auto", "meta": {...opcional} }
- Use vermelhas pra urgência (ex.: "Cobrar resposta hoje", "Aguardando há 5 dias")
- Amarelas pra alertas (ex.: "Lead esfriou", "Sem resposta 2 dias")
- Verdes pra positivos (ex.: "Demonstrou interesse", "Reunião marcada 18h")
- Azuis pra status neutros (ex.: "Conversa ativa", "Pediu prazo")
- Roxas pra compromissos (ex.: "Ligar amanhã", "Mandar proposta")
- Cinzas pra histórico (ex.: "Já viu o site")
- Identifique se a LOJA ficou de retornar (= "Aguardando retorno da loja")
- Identifique se EU fiquei de retornar (= "Eu devo retornar")
- Se houver menção a horário/data específica (reunião, ligação), crie tag com label tipo "Reunião hoje 18h" e meta.date em ISO
- Calcule há quantos dias foi a última mensagem trocada — se > 3 dias E o lead estava ativo, marque "Esfriando"
- Máximo 5 tags. Seja específico e útil.

REMINDER_AT:
- Se houver compromisso marcado (reunião, ligação): use a hora exata
- Se for follow-up natural: 1-3 dias no futuro
- Omita se nenhum lembrete fizer sentido

SUGGESTED_MESSAGE:
- Frase curta (2-4 linhas) pronta pra mandar AGORA no WhatsApp
- Tom humano brasileiro, casual, sem clichê
- Baseada no que ESTÁ escrito no histórico
- Se a loja ficou de responder e sumiu: cobrança leve
- Se eu fiquei de mandar algo: já mande no tom certo

Responda APENAS JSON: {"tags":[...], "suggested_message":"...", "reminder_at":"...|null", "summary":"1 frase do estado atual"}`;

Deno.serve(async (req) => {
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

    const { prospect_id } = await req.json() as { prospect_id: string };
    if (!prospect_id) return new Response(JSON.stringify({ error: "prospect_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: p } = await supabase
      .from("street_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!p) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const access = assertProspectAccess(callerAuth, p);
    if ((access as any).error) {
      const a = access as { error: string; status: number };
      return new Response(JSON.stringify({ error: a.error }), { status: a.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const log = Array.isArray(p.conversation_log) ? p.conversation_log : [];
    const sent = log.length
      ? log.map((m: any) => `[${m.at ?? ""}] ${m.from === "me" ? "EU" : "LEAD"}: ${m.text}`).join("\n")
      : "(nenhuma)";
    const pasted = String(p.pasted_history ?? "").trim();
    const manual = String(p.manual_intel ?? "").trim();

    const ctx = `LOJA: ${p.store_name}
RUA: ${p.street_name ?? "—"}
STATUS: ${p.status ?? "—"}
HOJE: ${new Date().toISOString()}
${manual ? `\n>>> O QUE EU SEI:\n${manual}\n` : ""}
${pasted ? `\n>>> HISTÓRICO COLADO DO WHATSAPP:\n${pasted}\n` : ""}
>>> MENSAGENS PELO SISTEMA:
${sent}`;

    let parsed: any = { tags: [], suggested_message: "", reminder_at: null, summary: "" };
    try {
      const r = await callAiWithFallback(supabase, {
        systemPrompt: SYS,
        userPrompt: ctx,
        jsonMode: true,
        temperature: 0.4,
      });
      const m = r.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch (e) {
      console.warn("[analyze] AI fail:", e);
    }

    // Preserva tags manuais, substitui apenas as auto
    const existing = Array.isArray(p.tags) ? p.tags : [];
    const manualTags = existing.filter((t: any) => t?.kind === "manual");
    const newAutoTags = (Array.isArray(parsed.tags) ? parsed.tags : []).slice(0, 5).map((t: any) => ({
      id: crypto.randomUUID(),
      label: String(t.label ?? "").slice(0, 50),
      color: ["red","yellow","green","blue","purple","gray"].includes(t.color) ? t.color : "gray",
      kind: "auto",
      meta: t.meta ?? null,
      created_at: new Date().toISOString(),
    })).filter((t: any) => t.label);

    const merged = [...manualTags, ...newAutoTags];

    let reminderAt: string | null = null;
    if (parsed.reminder_at && typeof parsed.reminder_at === "string") {
      const d = new Date(parsed.reminder_at);
      if (!isNaN(d.getTime())) reminderAt = d.toISOString();
    }

    await supabase.from("street_prospects").update({
      tags: merged,
      suggested_next_message: parsed.suggested_message || null,
      reminder_at: reminderAt,
      last_analysis_at: new Date().toISOString(),
    }).eq("id", prospect_id);

    return new Response(JSON.stringify({
      tags: merged,
      suggested_message: parsed.suggested_message ?? "",
      reminder_at: reminderAt,
      summary: parsed.summary ?? "",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[street-prospect-analyze] erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
