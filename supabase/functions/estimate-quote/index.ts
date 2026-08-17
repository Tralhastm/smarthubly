import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callAiWithFallback } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function extractJson(text: string): any | null {
  // Remove fences markdown ```json ... ```
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  // Tenta extrair primeiro objeto {} válido
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { tenantId, description } = await req.json();
    if (!tenantId || !description || typeof description !== "string") {
      return new Response(JSON.stringify({ error: "tenantId e description são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (description.length > 2000) {
      return new Response(JSON.stringify({ error: "Descrição muito longa (máx 2000 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();

    // Carrega tenant + variáveis + pacotes
    const [tenantRes, varsRes, pkgsRes] = await Promise.all([
      supabase.from("tenants").select("name, niche, quotes_intro_text").eq("id", tenantId).maybeSingle(),
      supabase.from("quote_variables").select("name, unit, price_per_unit, min_quantity, max_quantity, description").eq("tenant_id", tenantId).eq("active", true),
      supabase.from("quote_packages").select("name, description, price").eq("tenant_id", tenantId).eq("active", true),
    ]);

    const tenant = tenantRes.data;
    const variables = (varsRes.data || []) as any[];
    const packages = (pkgsRes.data || []) as any[];

    if (!tenant) {
      return new Response(JSON.stringify({ error: "Loja não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const varsList = variables.length
      ? variables.map(v => `- "${v.name}" | R$ ${Number(v.price_per_unit).toFixed(2)} por ${v.unit}${v.description ? ` (${v.description})` : ''}`).join("\n")
      : "(nenhuma variável cadastrada)";

    const pkgsList = packages.length
      ? packages.map(p => `- "${p.name}" | R$ ${Number(p.price).toFixed(2)}${p.description ? ` — ${p.description}` : ''}`).join("\n")
      : "(nenhum pacote cadastrado)";

    const systemPrompt = `Você é um assistente que ESTIMA orçamentos de prestadores de serviço (pedreiro, eletricista, mecânico, manicure, pintor, etc.) com base em variáveis cadastradas pelo lojista.

REGRAS:
1. Use APENAS as variáveis fornecidas para compor o orçamento. Se o pedido pede algo que não tem variável correspondente, diga isso na "explicacao" e estime usando a variável mais próxima.
2. Calcule QUANTIDADES baseado no que o cliente disse (metragem, tempo, mão de obra extra).
3. Compare preços comuns do mercado para o nicho — se a variável do lojista estiver muito acima/abaixo da média, mencione isso BREVEMENTE em "comparacao_mercado".
4. Sempre justifique o tempo estimado.
5. Se for um pacote pronto que se encaixa, recomende ele em "pacote_recomendado".

RESPONDA APENAS COM JSON VÁLIDO neste formato (sem markdown, sem texto antes/depois):
{
  "itens": [{ "nome_variavel": "string", "quantidade": número, "unidade": "string", "preco_unitario": número, "subtotal": número, "justificativa": "string" }],
  "tempo_estimado": "string",
  "tempo_justificativa": "string",
  "mao_de_obra_extra": "string ou null",
  "comparacao_mercado": "string ou null",
  "pacote_recomendado": "string ou null",
  "total_estimado": número,
  "explicacao": "string",
  "observacoes": "string"
}`;

    const userPrompt = `LOJA: ${tenant.name} (${tenant.niche || 'serviços'})

VARIÁVEIS DISPONÍVEIS (única referência de preço — NÃO invente):
${varsList}

PACOTES PRONTOS (caso o pedido se encaixe num deles):
${pkgsList}

PEDIDO DO CLIENTE:
"""
${description}
"""`;

    let aiResponse: string;
    try {
      const r = await callAiWithFallback(supabase, { systemPrompt, userPrompt, temperature: 0.3, maxTokens: 1500 });
      aiResponse = r.text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ai_error";
      const friendly = msg === "ai_unavailable"
        ? "Não foi possível gerar a estimativa no momento. Tente novamente em alguns minutos."
        : "Não foi possível gerar a estimativa.";
      return new Response(JSON.stringify({ error: friendly }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = extractJson(aiResponse);
    if (!parsed) {
      console.error("Failed to parse AI response:", aiResponse);
      return new Response(JSON.stringify({ error: "Resposta da IA inválida. Tente reformular o pedido." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ estimate: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("estimate-quote error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
