// #24 — IA sugere respostas para avaliações quando a loja ativa auto_review_ai_reply.
// A sugestão vai para a caixa de aprovação do lojista; nada é publicado automaticamente.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAiText } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const generateReply = async (supabase: any, rating: number, comment: string, tenantName: string) => {
  const sentiment = rating >= 4 ? "positivo" : rating >= 3 ? "neutro" : "negativo";
  const systemPrompt = `Você é o atendente da loja "${tenantName}". Responda em português brasileiro, em 1-2 frases, tom caloroso e humano. NÃO invente promoções nem prometa cupons.`;
  const userPrompt = `Um cliente deixou um review ${sentiment} (${rating}/5):\n\n"${comment || "(sem comentário)"}"\n\nSe negativo: peça desculpas e ofereça resolver. Se positivo: agradeça com energia. Se neutro: agradeça e convide a voltar.`;

  return await callAiText(supabase, { systemPrompt, userPrompt, temperature: 0.7, maxTokens: 200 });
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: tenants, error: tenantsError } = await supabase
    .from("tenants")
    .select("id, name, auto_review_ai_reply")
    .eq("auto_review_ai_reply", true);

  if (tenantsError) {
    console.error("review-ai-reply: tenants query failed", tenantsError.message);
    await supabase.from("automation_runs").insert({
      automation_type: "review_ai_reply",
      status: "error",
      metrics: { suggestions_created: 0 },
      error_message: `tenants query failed: ${tenantsError.message}`,
    });
    return new Response(JSON.stringify({ ok: false, error: tenantsError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  const failures: string[] = [];

  for (const t of tenants ?? []) {
    const { data: reviews, error: reviewsError } = await supabase
      .from("order_reviews")
      .select("id, rating, comment")
      .eq("tenant_id", t.id)
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    if (reviewsError) {
      failures.push(`${t.id}: reviews query failed: ${reviewsError.message}`);
      continue;
    }

    for (const r of reviews ?? []) {
      // Já existe sugestão para este review? Não gera outra (mesmo se descartada).
      const { data: existing, error: existingError } = await supabase
        .from("automation_suggestions")
        .select("id")
        .eq("tenant_id", t.id)
        .eq("type", "review_reply")
        .contains("payload", { review_id: r.id })
        .limit(1);

      if (existingError) {
        failures.push(`${t.id}/${r.id}: dedupe query failed: ${existingError.message}`);
        continue;
      }
      if ((existing ?? []).length > 0) continue;

      try {
        const reply = await generateReply(supabase, r.rating, r.comment || "", t.name);
        if (!reply) continue;
        const { error: insertError } = await supabase.from("automation_suggestions").insert({
          tenant_id: t.id,
          type: "review_reply",
          title: `Resposta sugerida para review ${r.rating}★`,
          description: reply,
          payload: { review_id: r.id, rating: r.rating, comment: r.comment, suggested_reply: reply },
        });
        if (insertError) {
          failures.push(`${t.id}/${r.id}: insert failed: ${insertError.message}`);
          continue;
        }
        processed++;
      } catch (err: any) {
        console.error("ai reply error", err?.message);
        failures.push(`${t.id}/${r.id}: ${err?.message ?? String(err)}`);
      }
    }
  }

  const status = failures.length === 0 ? "success" : "error";
  const { error: logError } = await supabase.from("automation_runs").insert({
    automation_type: "review_ai_reply",
    status,
    metrics: { suggestions_created: processed, failures: failures.slice(0, 10) },
    error_message: failures.length ? failures.slice(0, 10).join(" | ") : null,
  });
  if (logError) console.error("review_ai_reply run log failed", logError.message);

  return new Response(
    JSON.stringify({ ok: failures.length === 0, processed, failures }),
    { status: failures.length === 0 ? 200 : 207, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
