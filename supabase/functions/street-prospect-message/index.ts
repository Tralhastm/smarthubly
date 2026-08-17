// Gera próxima mensagem WhatsApp pra um lead da aba Prospecção (Mapa/Rua).
// Usa: histórico colado pelo usuário (conversas antigas) + conversation_log (mensagens já enviadas pelo sistema)
// + manual_intel (o que o operador sabe do lojista) + dados básicos do prospect.
// Pipeline IA: rascunho → revisor → retorna {message, draft, review_notes}.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAiWithFallback } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLATFORM_FEATURES = `PLATAFORMA SmartHubly (escolha a feature que case com a DOR real):
- Site/catálogo de delivery próprio sem comissão (alternativa ao iFood/Rappi)
- PDV pra venda no balcão profissional
- QR Code nas mesas, painel do garçom, KDS na cozinha
- Motoboys próprios, terceirizados ou Lalamove
- Gestão financeira + IA "Clara" que responde sobre o caixa
- Aba Fornecedores integrada, ranking de produtos, automações de recuperação, fidelidade, fiado
- Multi-nicho. Diferencial: integrado E sem comissão por pedido (ou mensalidade fixa transparente).`;

const SYS_DRAFT = `Você é um SDR brasileiro CONTINUANDO uma conversa de WhatsApp com dono de loja.
Receba: contexto da loja + histórico COLADO de conversas antigas + mensagens já enviadas pelo sistema.
Escreva a PRÓXIMA mensagem (2-5 linhas, humano, casual, PT-BR).
- Respeite o tom já estabelecido na conversa colada.
- Se o lead já contou uma dor, encaixe a feature exata do catálogo abaixo.
- NÃO se apresente de novo se já houve apresentação.
- NÃO repita o que já foi dito.
- Termine com pergunta de avanço ou CTA específico.
- Sem emoji no início, sem clichê, sem "espero que esteja bem".

${PLATFORM_FEATURES}

Responda APENAS o texto da mensagem.`;

const SYS_REVIEWER = `Você é EDITOR sênior de copywriting de WhatsApp em PT-BR.
Vai receber: contexto + histórico + rascunho. Devolva a MELHOR versão.
- Tom humano brasileiro, NUNCA robótico
- Curta, direta, zero clichê, pergunta forte ou CTA claro
- Respeite o estilo da conversa anterior
Responda em JSON: {"final": "texto pronto pra enviar", "notes": "1 frase sobre o ajuste"}`;

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

    const { data: roleRow } = await supabase
      .from("platform_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { prospect_id, instruction } = await req.json() as { prospect_id: string; instruction?: string };
    if (!prospect_id) return new Response(JSON.stringify({ error: "prospect_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: p } = await supabase
      .from("street_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!p) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const log = Array.isArray(p.conversation_log) ? p.conversation_log : [];
    const sentTranscript = log.length
      ? log.map((m: any) => `${m.from === "me" ? "EU" : "LEAD"}: ${m.text}`).join("\n")
      : "(nenhuma mensagem ainda enviada pelo sistema)";

    const pasted = String(p.pasted_history ?? "").trim();
    const manual = String(p.manual_intel ?? "").trim();

    const ctx = `LOJA: ${p.store_name}
RUA: ${p.street_name ?? "—"}
TELEFONE: ${p.contact_phone ?? "—"}
STATUS ATUAL: ${p.status ?? "—"}
NOTAS: ${p.notes ?? "—"}
${manual ? `\n>>> INFORMAÇÕES QUE EU (operador) SEI sobre esse lojista (use com peso máximo):\n${manual}\n` : ""}
${pasted ? `\n>>> HISTÓRICO DE WHATSAPP COLADO PELO OPERADOR (conversas anteriores fora do sistema — use como contexto principal de tom):\n${pasted}\n` : ""}
MENSAGENS JÁ ENVIADAS PELO SISTEMA:
${sentTranscript}
${instruction ? `\n>>> INSTRUÇÃO ESPECÍFICA PRA ESTA MENSAGEM: ${instruction}` : ""}`;

    // PASS 1: rascunho
    let draft = "";
    let drafterProvider = "fallback";
    try {
      const r1 = await callAiWithFallback(supabase, { systemPrompt: SYS_DRAFT, userPrompt: ctx, temperature: 0.85 });
      draft = r1.text;
      drafterProvider = r1.provider;
    } catch {
      draft = `Oi! Tudo certo aí na ${p.store_name}? Tô voltando aqui rapidinho — consegue me dar 2 minutos pra eu te mostrar uma coisa?`;
    }

    // PASS 2: revisor
    let final = draft;
    let reviewNotes = "";
    let reviewerProvider = "skipped";
    try {
      const r2 = await callAiWithFallback(supabase, {
        systemPrompt: SYS_REVIEWER,
        userPrompt: `CONTEXTO:\n${ctx}\n\nRASCUNHO:\n${draft}`,
        jsonMode: true,
        temperature: 0.4,
      });
      reviewerProvider = r2.provider;
      try {
        const parsed = JSON.parse(r2.text.match(/\{[\s\S]*\}/)?.[0] ?? r2.text);
        if (parsed?.final && typeof parsed.final === "string") {
          final = parsed.final.trim();
          reviewNotes = String(parsed.notes ?? "").trim();
        }
      } catch (e) {
        console.warn("[reviewer] parse fail:", e);
      }
    } catch (_e) {
      console.warn("[reviewer] indisponível");
    }

    await supabase.from("street_prospects").update({
      ai_draft: final,
      ai_review_notes: reviewNotes || null,
    }).eq("id", prospect_id);

    return new Response(JSON.stringify({
      message: final,
      draft,
      review_notes: reviewNotes,
      drafter_provider: drafterProvider,
      reviewer_provider: reviewerProvider,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[street-prospect-message] erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
