// Detecta site da loja (via Maps + Google) e identifica qual plataforma/sistema ela já usa.
// Objetivo: transformar o "ele já tem site/sistema" no NOSSO ponto forte na abordagem.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// catálogo de plataformas concorrentes / sistemas que dá pra detectar por URL ou marcador no HTML
const STACK_PATTERNS: Array<{ tag: string; rx: RegExp; weakness: string }> = [
  { tag: "ifood",        rx: /ifood\.com\.br|ifood\.com|ifo\.od/i, weakness: "paga taxa altíssima por pedido e não tem cliente próprio" },
  { tag: "anota-ai",     rx: /anota\.ai|pedidos\.anota\.ai/i,       weakness: "anota.ai cobra mensalidade + comissão, garçom/KDS limitados" },
  { tag: "goomer",       rx: /goomer\.app|goomerorder|goomer\.com/i, weakness: "goomer é caro pra pequeno, sem motoboy próprio integrado" },
  { tag: "cardapio.app", rx: /cardapio\.app|cardapioweb|cardapio\.com\.br/i, weakness: "cardápio.app é só catálogo, sem KDS/garçom/financeiro" },
  { tag: "delivery-much",rx: /deliverymuch|delivery\.much/i,        weakness: "delivery much é marketplace com taxa, sem cliente próprio" },
  { tag: "rappi",        rx: /rappi\.com\.br|rappi\.com/i,          weakness: "rappi taxa alta + entregador deles, sem fidelidade própria" },
  { tag: "uber-eats",    rx: /ubereats|uber\.com\/eats/i,           weakness: "uber eats taxa alta, lojista vira refém da plataforma" },
  { tag: "neemo",        rx: /neemo\.com\.br|neemo\.app/i,          weakness: "neemo é genérico, sem QR mesa/KDS/financeiro integrados" },
  { tag: "instabuy",     rx: /instabuy\.com\.br/i,                  weakness: "instabuy é só catálogo de mercado, sem operação completa" },
  { tag: "vipcommerce",  rx: /vipcommerce/i,                        weakness: "vipcommerce é só mercado online, sem garçom/KDS" },
  { tag: "mercadapp",    rx: /mercadapp/i,                          weakness: "mercadapp foca em mercado, sem fluxo de restaurante" },
  { tag: "abrahao",      rx: /abrah[aã]o\.com|sistemaabrah/i,       weakness: "abrahão é PDV antigo, sem catálogo público bonito" },
  { tag: "consinco",     rx: /consinco/i,                           weakness: "consinco é ERP pesado, longe do delivery/balcão moderno" },
  { tag: "linx",         rx: /linx\.com\.br/i,                      weakness: "linx é caro, sem agilidade pra delivery próprio" },
  { tag: "tray",         rx: /tray\.com\.br/i,                      weakness: "tray é e-commerce genérico, não opera mesa nem balcão" },
  { tag: "wordpress",    rx: /wp-content|wp-includes|wordpress/i,   weakness: "site WordPress estático — sem pedidos online, só vitrine" },
  { tag: "wix",          rx: /wix\.com|wixsite|wixstatic/i,         weakness: "Wix só vitrine — não tem cardápio com pedido, KDS, garçom" },
  { tag: "google-sites", rx: /sites\.google\.com/i,                 weakness: "página estática do Google — sem pedido, sem operação" },
  { tag: "linktree",     rx: /linktr\.ee/i,                         weakness: "linktree só agrega links — não vende, não opera, não fideliza" },
  { tag: "shopify",      rx: /shopify\.com|myshopify/i,             weakness: "shopify é e-commerce de produto físico, não roda restaurante/balcão" },
  { tag: "loja-integrada",rx: /lojaintegrada/i,                     weakness: "loja integrada é só vitrine, sem KDS/garçom/financeiro" },
];

const HARDCODED_DOMAINS_TO_IGNORE = new Set([
  "instagram.com","facebook.com","fb.com","wa.me","whatsapp.com","youtube.com","tiktok.com",
  "google.com","goo.gl","maps.google.com","maps.app.goo.gl","linktr.ee","beacons.ai",
]);

async function fetchHtml(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" }, redirect: "follow" });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

function extractWebsiteFromMaps(html: string): string | null {
  // tenta achar primeiro link http(s) que não seja maps/google/insta/face
  const re = /https?:\/\/([a-z0-9\-]+(?:\.[a-z0-9\-]+)+)(\/[^\s"'<>]*)?/gi;
  let m: RegExpExecArray | null;
  const seen = new Map<string, string>();
  while ((m = re.exec(html)) !== null) {
    const host = m[1].toLowerCase().replace(/^www\./, "");
    if (HARDCODED_DOMAINS_TO_IGNORE.has(host)) continue;
    if (host.endsWith(".google.com") || host.endsWith(".gstatic.com") || host.endsWith(".googleapis.com")) continue;
    const full = `https://${host}${m[2] ?? ""}`.split(/[?#]/)[0];
    if (!seen.has(host)) seen.set(host, full);
  }
  // prioriza domínios .com.br
  const sorted = [...seen.values()].sort((a, b) => (b.includes(".com.br") ? 1 : 0) - (a.includes(".com.br") ? 1 : 0));
  return sorted[0] ?? null;
}

function detectStack(html: string, siteUrl: string | null): { tags: string[]; weaknesses: string[] } {
  const tags: string[] = [];
  const weak: string[] = [];
  const hay = `${siteUrl ?? ""}\n${html}`;
  for (const p of STACK_PATTERNS) {
    if (p.rx.test(hay) && !tags.includes(p.tag)) {
      tags.push(p.tag);
      weak.push(p.weakness);
    }
  }
  return { tags, weaknesses: weak };
}

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

    const { prospect_id } = await req.json();
    if (!prospect_id) return new Response(JSON.stringify({ error: "prospect_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: p } = await supabase.from("remote_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!p) return new Response(JSON.stringify({ error: "prospect_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 1) Prioridade MÁXIMA: site inserido manualmente pelo operador
    let siteUrl: string | null = p.manual_website_url ?? p.website_url ?? null;
    let foundOnMaps = false;
    const combinedHtmls: string[] = [];

    // 2) se ainda não tem site, tenta achar via Google Maps local search
    if (!siteUrl) {
      const q = `${p.business_name} ${p.city ?? ""} ${p.state ?? ""}`.trim();
      const mapsHtml = await fetchHtml(`https://www.google.com/search?tbm=lcl&q=${encodeURIComponent(q)}&hl=pt-BR&gl=br`);
      combinedHtmls.push(mapsHtml);
      siteUrl = extractWebsiteFromMaps(mapsHtml);
      if (siteUrl) foundOnMaps = true;
    }

    // 2) busca no Google geral pra ver onde o nome aparece (anota.ai/goomer/ifood etc.)
    const googleHtml = await fetchHtml(`https://www.google.com/search?q=${encodeURIComponent(`"${p.business_name}" ${p.city ?? ""}`)}&hl=pt-BR&gl=br`);
    combinedHtmls.push(googleHtml);

    // 3) se tem site, baixa o HTML pra detectar tecnologia
    if (siteUrl) {
      const siteHtml = await fetchHtml(siteUrl);
      combinedHtmls.push(siteHtml);
    }

    const { tags, weaknesses } = detectStack(combinedHtmls.join("\n\n"), siteUrl);

    const summary = tags.length
      ? `Detectei que ${p.business_name} usa: ${tags.join(", ")}. Pontos fracos pra explorar: ${weaknesses.slice(0, 3).join(" | ")}`
      : siteUrl
        ? `Tem site (${siteUrl}) mas não consegui identificar a plataforma — provavelmente solução caseira/fraca.`
        : "Sem site detectado nem no Google Maps — alvo claro pra catálogo próprio.";

    const patch: Record<string, unknown> = {
      competitor_stack: tags,
      stack_summary: summary,
      stack_scraped_at: new Date().toISOString(),
    };
    // Se achou site e não era manual, atualiza website_url
    if (siteUrl && !p.manual_website_url && (!p.website_url || foundOnMaps)) {
      patch.website_url = siteUrl;
      patch.has_website = true;
    }

    const { error: updErr } = await supabase.from("remote_prospects").update(patch).eq("id", prospect_id);
    if (updErr) return new Response(JSON.stringify({ error: "update_failed", detail: updErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({
      ok: true,
      site_url: siteUrl,
      found_on_maps: foundOnMaps,
      stack: tags,
      summary,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[prospect-site-stack] erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
