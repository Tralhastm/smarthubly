// Busca leads via Lovable AI, com FALLBACK para "worker" local (templates determinísticos)
// quando a IA falhar (sem créditos, rate limit, erro de rede).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT_SYSTEM = `Você é um assistente que pesquisa pequenos negócios locais (delivery, restaurantes, comércios) no Brasil.
Dado uma cidade e um nicho, retorne uma lista REALISTA de 8-15 estabelecimentos que provavelmente existem nessa região.
Para cada um: business_name, has_website (bool), has_instagram (bool), reasoning (1 frase).
NUNCA invente instagram_handle nem website_url — sempre retorne null nesses campos. O sistema descobre depois via busca real.
PRIORIZE pequenos/médios independentes. Responda APENAS JSON válido { "leads": [...] }.`;

// ---------- WORKER LOCAL (fallback sem IA) ----------
const NICHE_TEMPLATES: Record<string, { prefixes: string[]; suffixes: string[] }> = {
  default: { prefixes: ["Casa do","Cantinho do","Empório","Espaço","Ponto do","Recanto do","Sabor do","Tempero do"], suffixes: ["Sabor","Bairro","Centro","Mestre","Chef","Brasil","do Povo","Caseiro"] },
  hamburgueria: { prefixes: ["Burger","Smash","Big","King","Arte","Rei do","Mestre do","Casa do"], suffixes: ["Burger","Hamburgueria","Lanches","Smash","Grill","Artesanal","House","Lounge"] },
  pizzaria: { prefixes: ["Pizzaria","Forno","Bella","Don","Mamma","La","Casa da","Toscana"], suffixes: ["Pizza","Forneria","Italiana","do Chef","Napolitana","Express","do Bairro","Gourmet"] },
  açaí: { prefixes: ["Açaí","Tropical","Mania de","Império do","Tribo do","Sabor do","Vibe"], suffixes: ["Açaí","da Praia","Tropical","Mix","Power","do Norte","Express","Vital"] },
  acai: { prefixes: ["Açaí","Tropical","Mania de","Império do","Tribo do","Sabor do","Vibe"], suffixes: ["Açaí","da Praia","Tropical","Mix","Power","do Norte","Express","Vital"] },
  marmitaria: { prefixes: ["Marmita","Sabor da","Cozinha da","Tempero da","Casa da","Quentinha"], suffixes: ["Caseira","da Vovó","da Mamãe","do Chef","Saudável","Fitness","do Trabalhador"] },
  doceria: { prefixes: ["Doce","Confeitaria","Atelier","Bolo da","Sabor","Mel &"], suffixes: ["Doce","Sabor","Encanto","Confeitaria","da Maria","Caseiros","Gourmet"] },
  bebidas: { prefixes: ["Adega","Empório","Casa das","Disk","Loja das","Mundo das"], suffixes: ["Bebidas","do Bairro","Premium","Distribuidora","Express","24h","Gelada"] },
  conveniência: { prefixes: ["Conveniência","Mercadinho","Loja do","Empório","Mini Mercado"], suffixes: ["Express","do Bairro","24h","Praia","Esquina","Centro"] },
};
const FAMILY = ["Silva","Souza","Lima","Costa","Rocha","Mendes","Alves","Pereira","Oliveira","Santos"];
function pick<T>(a: T[], s: number): T { return a[s % a.length]; }
function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"").slice(0,22);
}
function workerGenerate(city: string, niche: string, count = 10) {
  const tpl = NICHE_TEMPLATES[niche.toLowerCase().trim()] ?? NICHE_TEMPLATES.default;
  const cityShort = (city.split(/[ ,/-]/)[0] ?? city);
  const out: any[] = []; const used = new Set<string>(); const seed0 = Date.now();
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const s = seed0 + i * 7919;
    const useFamily = i % 3 === 0;
    const name = useFamily
      ? `${pick(tpl.prefixes, s)} ${pick(FAMILY, s >> 3)}`
      : `${pick(tpl.prefixes, s)} ${pick(tpl.suffixes, s >> 3)}`;
    if (used.has(name)) continue; used.add(name);
    const has_website = (s % 10) < 3;
    const has_instagram = (s % 100) < 85;
    // NÃO inventa handle — fica null até enriquecimento real encontrar
    out.push({
      business_name: name, has_website, has_instagram, instagram_handle: null, website_url: null,
      reasoning: !has_website && has_instagram ? "Sem site mas ativo no Insta — perfil ideal."
               : !has_website ? "Sem site — oportunidade de canal próprio."
               : "Tem site, mas pode querer reduzir comissão de marketplace.",
    });
  }
  return out;
}
// ---------- /WORKER ----------

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

    const { city, niche } = await req.json();
    if (!city || !niche) return new Response(JSON.stringify({ error: "city e niche obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let leads: any[] = [];
    let usedFallback = false;
    let fallbackReason: string | null = null;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY) {
      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: PROMPT_SYSTEM },
              { role: "user", content: `Cidade: ${city}\nNicho: ${niche}` },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (aiResp.ok) {
          const aiJson = await aiResp.json();
          const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
          try {
            const parsed = JSON.parse(content);
            leads = Array.isArray(parsed.leads) ? parsed.leads : [];
          } catch { leads = []; }
        } else {
          const t = await aiResp.text();
          usedFallback = true;
          fallbackReason = aiResp.status === 402 || t.includes("payment_required") ? "no_credits"
                         : aiResp.status === 429 ? "rate_limited" : `ai_${aiResp.status}`;
          console.warn("AI failed, using worker:", fallbackReason, t.slice(0, 200));
        }
      } catch (e) {
        usedFallback = true;
        fallbackReason = "ai_network_error";
        console.warn("AI network error, using worker:", e);
      }
    } else {
      usedFallback = true;
      fallbackReason = "no_api_key";
    }

    if (leads.length === 0) {
      usedFallback = true;
      if (!fallbackReason) fallbackReason = "ai_empty_result";
      leads = workerGenerate(city, niche, 10);
    }

    const rows = leads.map((l: any) => {
      const hasSite = !!l.has_website;
      const hasIg = !!l.has_instagram;
      let score = 30;
      if (!hasSite && hasIg) score = 100;
      else if (!hasSite) score = 70;
      else if (hasIg) score = 50;
      return {
        business_name: String(l.business_name ?? "").slice(0, 200),
        city, niche,
        has_website: hasSite,
        website_url: l.website_url ?? null,
        has_instagram: hasIg,
        instagram_handle: null, // sempre null no início — só é populado pelo prospect-enrich após validação real
        phone: null,
        priority_score: score,
        status: "new",
        notes: l.reasoning ?? null,
        source: usedFallback ? "worker_fallback" : "ai_search",
        raw_data: l,
        created_by: user.id,
      };
    }).filter((r: any) => r.business_name);

    if (rows.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, leads: [], fallback: usedFallback, fallback_reason: fallbackReason }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error: insErr } = await supabase
      .from("remote_prospects").insert(rows).select("*");
    if (insErr) return new Response(JSON.stringify({ error: "insert_failed", detail: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({
      inserted: inserted?.length ?? 0,
      leads: inserted,
      fallback: usedFallback,
      fallback_reason: fallbackReason,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
