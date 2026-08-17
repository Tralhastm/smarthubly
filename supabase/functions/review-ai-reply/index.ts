// #24 — IA responde reviews automaticamente quando ativado
// Cron a cada 1h: para cada review novo (sem resposta) de tenant com toggle on, gera resposta via Lovable AI e cria sugestão (admin aprova) OU posta direto se auto_publish=true
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

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, auto_review_ai_reply")
    .eq("auto_review_ai_reply", true);

  let processed = 0;
  for (const t of tenants ?? []) {
    const { data: reviews } = await supabase
      .from("order_reviews")
      .select("id, rating, comment")
      .eq("tenant_id", t.id)
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(20);
    for (const r of reviews ?? []) {
      // Só sugere se ainda não houver sugestão pendente para esse review
      const { data: existing } = await supabase
        .from("automation_suggestions")
        .select("id")
        .eq("tenant_id", t.id)
        .eq("type", "review_reply")
        .contains("payload", { review_id: r.id })
        .maybeSingle();
      if (existing) continue;

      try {
        const reply = await generateReply(supabase, r.rating, r.comment || "", t.name);
        if (!reply) continue;
        await supabase.from("automation_suggestions").insert({
          tenant_id: t.id,
          type: "review_reply",
          title: `Resposta sugerida para review ${r.rating}★`,
          description: reply,
          payload: { review_id: r.id, rating: r.rating, comment: r.comment, suggested_reply: reply },
        });
        processed++;
      } catch (err: any) {
        console.error("ai reply error", err?.message);
      }
    }
  }

  await supabase.from("automation_runs").insert({
    automation_type: "review_ai_reply",
    status: "success",
    metrics: { suggestions_created: processed },
  });

  return new Response(JSON.stringify({ ok: true, processed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
