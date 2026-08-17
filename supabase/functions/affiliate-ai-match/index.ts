// #26 — IA sugere produtos afiliados relevantes
// Cron semanal: para cada tenant com toggle on, analisa top categorias e sugere 3 produtos afiliados
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAiJson } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function logRun(supabase: any, tenant_id: string | null, status: string, metrics: any, error?: string) {
  await supabase.from("automation_runs").insert({
    tenant_id,
    automation_type: "affiliate_match",
    status,
    metrics,
    error_message: error || null,
  });
}

const generateMatches = async (supabase: any, tenantName: string, topCats: string[]) => {
  const systemPrompt = `Você é um especialista em afiliados (Amazon, Mercado Livre, Shopee). Responda APENAS com JSON válido sem markdown.`;
  const userPrompt = `A loja "${tenantName}" vende principalmente nas categorias: ${topCats.join(", ")}.\n\nSugira 3 produtos afiliados COMPLEMENTARES que essa loja poderia vender em conjunto. Responda no formato JSON exato:\n{"suggestions":[{"name":"...","category":"...","rationale":"...","suggested_network":"amazon|mercadolivre|shopee"}]}`;

  try {
    const parsed = await callAiJson<any>(supabase, { systemPrompt, userPrompt, temperature: 0.7, maxTokens: 800 });
    if (Array.isArray(parsed)) return parsed;
    return parsed?.suggestions ?? parsed?.products ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ai";
    if (msg === "ai_unavailable") throw new Error("IA indisponível");
    return [];
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let tenantFilter: string | null = null;
  try {
    const body = await req.clone().json().catch(() => ({}));
    tenantFilter = typeof body?.tenant_id === "string" ? body.tenant_id : null;
  } catch (_) { /* ignore invalid/empty body */ }

  let tenantsQuery = supabase
    .from("tenants")
    .select("id, name, auto_affiliate_match, store_mode")
    .eq("auto_affiliate_match", true);
  if (tenantFilter) tenantsQuery = tenantsQuery.eq("id", tenantFilter);
  const { data: tenants } = await tenantsQuery;

  let inserted = 0;
  let processed = 0;
  const errors: Array<{ tenant_id: string; tenant_name: string; message: string }> = [];

  for (const t of tenants ?? []) {
    if (t.store_mode !== "affiliate") continue;
    processed++;
    let tenantInserted = 0;
    try {
      const { data: prods } = await supabase
        .from("products")
        .select("category, affiliate_url")
        .eq("tenant_id", t.id)
        .limit(200);
      const counts = new Map<string, number>();
      (prods ?? []).forEach((p: any) => {
        const category = p.category || "Geral";
        counts.set(category, (counts.get(category) ?? 0) + 1);
      });
      const topCats = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c).filter(Boolean);
      if (topCats.length === 0) {
        await logRun(supabase, t.id, "success", { suggestions_created: 0, products_checked: 0, skipped: "sem_produtos" });
        continue;
      }

      const matches = await generateMatches(supabase, t.name, topCats);
      for (const m of matches.slice(0, 3)) {
        await supabase.from("affiliate_match_suggestions").insert({
          tenant_id: t.id,
          product_name: m.name || "Sem nome",
          product_description: m.description || "",
          category: m.category || "",
          suggested_network: m.suggested_network || null,
          rationale: m.rationale || "",
          match_score: 75,
        });
        await supabase.from("automation_suggestions").insert({
          tenant_id: t.id,
          type: "affiliate_match",
          title: `Achadinho sugerido: ${m.name || "Produto afiliado"}`,
          description: `${m.category || "Categoria"}${m.suggested_network ? ` • ${m.suggested_network}` : ""}. ${m.rationale || "Combina com o catálogo atual."}`,
          payload: {
            product_name: m.name || "Produto afiliado",
            category: m.category || "",
            suggested_network: m.suggested_network || null,
            rationale: m.rationale || "",
          },
          status: "pending",
        });
        tenantInserted++;
        inserted++;
      }
      await logRun(supabase, t.id, "success", {
        suggestions_created: tenantInserted,
        products_checked: prods?.length || 0,
        products_without_link: (prods ?? []).filter((p: any) => !p.affiliate_url).length,
        top_categories: topCats,
      });
    } catch (err: any) {
      console.error("affiliate match error", t.id, err?.message);
      errors.push({ tenant_id: t.id, tenant_name: t.name, message: err?.message || "erro desconhecido" });
      await logRun(supabase, t.id, "error", { suggestions_created: tenantInserted }, err?.message || "erro desconhecido");
    }
  }

  return new Response(JSON.stringify({ ok: errors.length === 0, inserted, processed, errors }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
