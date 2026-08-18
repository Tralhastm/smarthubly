// Coleta avaliações públicas do Google Maps (incluindo respostas do dono)
// para um prospect e usa IA pra extrair dores reais.
//
// Estratégia:
//  1) Resolve URL/place no Google Maps (maps_url ou nome+cidade+UF)
//  2) Pega HTML do place no maps.google.com/?cid=... ou search local
//  3) Extrai trechos de reviews + respostas do dono via regex sobre o HTML/JSON embed
//  4) Filtra negativas (1-3 estrelas / palavras-chave) + recentes
//  5) IA resume dores em tags + parágrafo curto
//  6) Persiste em remote_prospects.reviews_sample / pain_signals / pain_summary

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAiWithFallback } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";

type RawReview = { text: string; rating?: number; owner_reply?: string; when?: string };

const NEG_HINTS = [
  "demora", "demorou", "demorad", "atrasou", "atrasad", "frio", "fria",
  "errado", "errada", "faltou", "faltand", "cancelou", "cancelad",
  "pessimo", "péssimo", "horrivel", "horrível", "ruim", "lixo", "decepcion",
  "ninguem atende", "ninguém atende", "nao atende", "não atende",
  "sumiu", "perdeu", "perderam", "esquecer", "esqueceram",
  "caro", "preço alto", "preco alto", "abusiv",
  "mal educad", "grosso", "grossa", "rude",
  "ifood", "rappi", "marketplace",
  "entrega", "entregador", "motoboy",
  "fila", "espera", "esperei",
];

function htmlFetch(url: string): Promise<string> {
  return fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" } })
    .then(r => r.ok ? r.text() : "")
    .catch(() => "");
}

function unescapeJson(s: string): string {
  try { return JSON.parse(`"${s.replace(/"/g, '\\"').replace(/\\u/g, "\\u")}"`); } catch { return s; }
}

// Extrai blocos que aparecem no JSON embarcado do Google Maps.
// Reviews aparecem como ["texto", ...] dentro de arrays com nota numérica
// e às vezes seguidos por reply do dono ("Resposta do proprietário").
function extractReviewsFromHtml(html: string): RawReview[] {
  if (!html) return [];
  const out: RawReview[] = [];
  // 1) Padrão: trechos longos em PT entre aspas escapadas no JSON inline
  const candidates = new Set<string>();
  // textos com 30..600 chars, contendo espaço, que pareçam frases reais
  const re = /"((?:[^"\\]|\\.){30,600})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (!raw.includes(" ")) continue;
    if (!/[a-záéíóúçãõ]/i.test(raw)) continue;
    if (/^https?:|googleusercontent|gstatic|maps\.google|^\/|^@/i.test(raw)) continue;
    if (/^[A-Z0-9_\-\.\/=]+$/.test(raw)) continue;
    const clean = unescapeJson(raw).trim();
    if (clean.length < 30) continue;
    if (/^[\d\s\-\:\.,]+$/.test(clean)) continue;
    if (!/\s[a-záéíóúç]{3,}\s/i.test(clean)) continue;
    candidates.add(clean);
  }
  for (const text of candidates) {
    const lower = text.toLowerCase();
    const negHit = NEG_HINTS.some(h => lower.includes(h));
    // mantém negativos garantidos + uma amostra de neutros
    if (negHit) out.push({ text, rating: 2 });
    else if (out.length < 25) out.push({ text });
    if (out.length >= 40) break;
  }
  // 2) Tenta capturar "Resposta do proprietário"
  const replyRe = /Resposta do proprietário[^"]{0,40}"((?:[^"\\]|\\.){10,500})"/g;
  let r: RegExpExecArray | null;
  const replies: string[] = [];
  while ((r = replyRe.exec(html)) !== null) replies.push(unescapeJson(r[1]).trim());
  // anexa replies a reviews quando der (pareamento simples por ordem)
  replies.slice(0, out.length).forEach((rep, i) => { out[i].owner_reply = rep; });
  return out.slice(0, 30);
}

async function fetchMapsHtmls(p: any): Promise<string> {
  const name = String(p.business_name ?? "").trim();
  const city = String(p.city ?? "").trim();
  const state = String(p.state ?? "").trim();
  const queries = [
    `${name} ${city} ${state} avaliações`,
    `${name} ${city} reviews`,
  ];
  const urls: string[] = [];
  if (p.maps_url) urls.push(String(p.maps_url));
  urls.push(`https://www.google.com/maps/search/${encodeURIComponent(queries[0])}?hl=pt-BR`);
  urls.push(`https://www.google.com/search?tbm=lcl&q=${encodeURIComponent(queries[0])}&hl=pt-BR&gl=br`);
  urls.push(`https://www.google.com/search?q=${encodeURIComponent(name + " " + city + " avaliações google")}&hl=pt-BR&gl=br`);
  const htmls = await Promise.all(urls.map(htmlFetch));
  return htmls.join("\n\n");
}

const SYS_PAIN = `Você analisa avaliações reais do Google Maps de um restaurante/loja e extrai DORES de NEGÓCIO acionáveis.
Foque em problemas que uma plataforma de delivery próprio, gestão de garçons, motoboys, comanda QR, integração Lalamove ou financeiro/IA empresarial poderia resolver.
NÃO invente. Só use o que o texto sugere.

Devolva JSON estrito:
{
  "pain_signals": ["tag-curta", ...],   // 0 a 6 tags em PT-BR, kebab-case (ex: "demora-entrega", "atendimento-grosseiro", "pedido-errado", "preco-alto-ifood", "fila-balcao", "comanda-bagunca", "sumiu-pedido")
  "pain_summary": "1 a 2 frases descrevendo a dor real do dono em linguagem natural"
}
Se não houver evidência clara de dor, retorne pain_signals=[] e pain_summary="".`;

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

    const { prospect_id } = await req.json();
    if (!prospect_id) return new Response(JSON.stringify({ error: "prospect_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: p } = await supabase.from("remote_prospects").select("*").eq("id", prospect_id).maybeSingle();
    if (!p) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const access = assertProspectAccess(callerAuth, p);
    if ((access as any).error) {
      const a = access as { error: string; status: number };
      return new Response(JSON.stringify({ error: a.error }), { status: a.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const html = await fetchMapsHtmls(p);
    const reviews = extractReviewsFromHtml(html);

    // Prioriza negativas + com owner_reply
    const negatives = reviews.filter(r => {
      const t = r.text.toLowerCase();
      return NEG_HINTS.some(h => t.includes(h));
    });
    const sample = (negatives.length >= 3 ? negatives : reviews).slice(0, 15);

    let pain_signals: string[] = [];
    let pain_summary = "";

    if (sample.length > 0) {
      const userMsg = sample.map((r, i) => `[${i + 1}]${r.rating ? ` (${r.rating}★)` : ""} ${r.text}${r.owner_reply ? `\n   ↳ Dono: ${r.owner_reply}` : ""}`).join("\n\n");
      try {
        const r = await callAiWithFallback(supabase, {
          systemPrompt: SYS_PAIN, userPrompt: userMsg, jsonMode: true, temperature: 0.3,
        });
        const parsed = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] ?? r.text);
        if (Array.isArray(parsed?.pain_signals)) {
          pain_signals = parsed.pain_signals
            .map((s: unknown) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
            .filter((s: string) => s.length >= 3 && s.length <= 40)
            .slice(0, 6);
        }
        if (typeof parsed?.pain_summary === "string") pain_summary = parsed.pain_summary.trim().slice(0, 400);
      } catch (e) {
        console.warn("[prospect-reviews] IA parse fail:", e);
      }
    }

    await supabase.from("remote_prospects").update({
      reviews_sample: sample,
      pain_signals,
      pain_summary: pain_summary || null,
      reviews_scraped_at: new Date().toISOString(),
    }).eq("id", prospect_id);

    return new Response(JSON.stringify({
      ok: true,
      reviews_found: reviews.length,
      negatives_found: negatives.length,
      sample_size: sample.length,
      pain_signals, pain_summary,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[prospect-reviews] erro:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
