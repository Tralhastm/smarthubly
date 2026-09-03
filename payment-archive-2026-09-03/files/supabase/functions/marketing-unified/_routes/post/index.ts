import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateImageCascade } from "../../../_shared/image-gen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Format =
  | "post_dia"        // legenda completa pro feed
  | "story"           // texto curto pro story
  | "bio"             // bio Instagram
  | "reels_script"    // roteiro de reels (3 cenas)
  | "carousel"        // 5 slides
  | "whatsapp"        // copy whatsapp p/ enviar
  | "hashtags";       // só hashtags

interface Body {
  scope: "tenant" | "platform";
  tenantId?: string;
  format: Format;
  tone?: string;
  extraContext?: string;
  audience?: string;
  generateImage?: boolean;   // se true, gera imagem junto
  imagePrompt?: string;      // se vazio, IA gera prompt baseado no texto
  imageStyle?: ImageStyle;   // estilo visual da imagem
}

type ImageStyle = "auto" | "realistic" | "cartoon" | "3d" | "minimal" | "vintage" | "anime";

const STYLE_DIRECTIVES: Record<ImageStyle, string> = {
  auto: "Choose the visual style that best fits the post mood and product (default: realistic commercial photography).",
  realistic: "Style: hyper-realistic commercial photography, DSLR, natural lighting, shallow depth of field, photo-real textures.",
  cartoon: "Style: modern flat cartoon illustration, bold clean lines, bright saturated colors, friendly characters, vector look (think modern brand mascot illustration).",
  "3d": "Style: polished 3D render, Pixar-quality, soft global illumination, glossy materials, cute friendly shapes, octane render look.",
  minimal: "Style: minimalist editorial design, lots of negative space, 2-3 colors max, single hero subject, clean studio background.",
  vintage: "Style: vintage retro poster aesthetic, slightly grainy, warm muted palette, 70s-80s commercial photography vibe.",
  anime: "Style: modern anime/manga illustration, cel-shaded, expressive characters, vibrant Studio Ghibli-like backgrounds.",
};

function getSupabase() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function gatherTenantContext(supabase: any, tenantId: string) {
  const { data: t, error: tErr } = await supabase
    .from("tenants")
    .select("name, slug, niche, address, phone, whatsapp, promo_title, promo_text, promo_active, description")
    .eq("id", tenantId).maybeSingle();
  if (tErr) console.error("tenant select error:", tErr);

  const { data: products } = await supabase
    .from("products")
    .select("name, price, description, category")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .limit(15);

  // Top produtos por venda (últimos 30 dias)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders } = await supabase
    .from("orders")
    .select("items, total, status, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .limit(200);

  const sales: Record<string, { qty: number; revenue: number }> = {};
  let totalOrders = 0;
  let totalRevenue = 0;
  for (const o of orders || []) {
    if (o.status === "cancelled") continue;
    totalOrders += 1;
    totalRevenue += Number(o.total || 0);
    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) {
      const name = it?.name || it?.product_name || "Item";
      const qty = Number(it?.quantity || 1);
      const price = Number(it?.price || 0);
      if (!sales[name]) sales[name] = { qty: 0, revenue: 0 };
      sales[name].qty += qty;
      sales[name].revenue += qty * price;
    }
  }
  const topSold = Object.entries(sales)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5)
    .map(([name, v]) => `${name} (${v.qty}un)`);

  return {
    tenant: t,
    productsSample: (products || []).map((p: any) =>
      `- ${p.name} R$${Number(p.price || 0).toFixed(2)}${p.category ? ` [${p.category}]` : ""}`
    ).join("\n"),
    topSold,
    totalOrders,
    totalRevenue,
  };
}

function buildSystemPrompt(format: Format, tone?: string) {
  const toneLine = tone ? `Tom de voz: ${tone}.` : "Tom: humano, vendedor, descontraído sem ser forçado.";
  const base = `Você é um social media sênior brasileiro especialista em pequenos negócios locais.
Escreve em pt-BR, fala como dono de negócio fala, NUNCA usa palavras de marketing batidas tipo "potencialize", "alavanque", "transforme sua jornada".
${toneLine}
Use emojis com moderação (no máx 3-4 por bloco). Não invente dados que não foram passados.

REGRA DE OURO DA 1ª LINHA: a primeira frase do post é um GANCHO direto e provocativo, nunca um anúncio de si mesma. PROIBIDO começar com "Aqui está", "Apresentando", "Olha o que", "Segue abaixo". Prefira afirmações fortes, dor real ou pergunta que cutuca: "Você não abriu uma hamburgueria para ser sócio do iFood.", "30% do seu lucro está morrendo na chapa.", "O cliente que entra na sua loja deveria poder pedir dela."`;

  const formatRules: Record<Format, string> = {
    post_dia: `Saída: 1 legenda pronta pro Instagram (até 600 caracteres) + 1 chamada curta pro destaque + 8-12 hashtags relevantes (locais quando fizer sentido).
Estrutura: Hook na 1ª linha. Quebra de linha. Corpo (1-3 frases). CTA claro. Hashtags no final.`,
    story: `Saída: até 3 telas de story (cada uma com no máx 90 caracteres). Marque [TELA 1], [TELA 2], [TELA 3]. Última tela com CTA (link/sticker).`,
    bio: `Saída: 3 opções de bio do Instagram (cada uma até 150 caracteres). Inclua emoji, proposta de valor e CTA. Numere 1, 2, 3.`,
    reels_script: `Saída: roteiro de Reels de 15-25s. Formato: [CENA 1 — 0-3s]: ... [CENA 2 — 3-12s]: ... [CENA 3 — 12-20s]: ... + Legenda sugerida + 5 hashtags.`,
    carousel: `Saída: 5 slides numerados. Cada slide com TÍTULO (até 6 palavras) e CORPO (1-2 frases). Último slide com CTA. Depois: legenda do post (até 400 chars) + 6 hashtags.`,
    whatsapp: `Saída: 1 mensagem pronta pra disparar no WhatsApp (até 350 caracteres). Personalizada, sem parecer spam, com link/CTA no fim.`,
    hashtags: `Saída: 20 hashtags relevantes (mix de nicho, localização e gerais). Sem # repetidas. Apenas a lista, separada por espaço.`,
  };

  return `${base}\n\n${formatRules[format]}`;
}

function buildUserPrompt(body: Body, ctx: any | null) {
  if (body.scope === "platform") {
    return `Negócio: Plataforma SaaS de delivery/lojas online pra pequenos comerciantes brasileiros (bares, hambúrguerias, mercadinhos, distribuidoras de bebidas, salões etc).
Diferencial: 500 primeiros pagam R$60/mês fixo (sem taxa por pedido). Trial de R$9,90 por 2 meses. Loja online em minutos com IA que analisa o cardápio.
Público alvo: ${body.audience || "donos de pequenos comércios locais que ainda usam só WhatsApp ou iFood caro"}.
Briefing extra do usuário: ${body.extraContext || "(nenhum)"}.

Gere o conteúdo no formato pedido.`;
  }

  const t = ctx?.tenant || {};
  return `Loja: ${t.name || "—"} (${t.slug || "—"})
Nicho: ${t.niche || "—"}
Endereço: ${t.address || "—"}
Descrição: ${t.description || "—"}
Promo ativa: ${t.promo_active ? `${t.promo_title} — ${t.promo_text}` : "(nenhuma)"}
Telefone: ${t.phone || "—"}
WhatsApp: ${t.whatsapp || "—"}

Catálogo (amostra):
${ctx?.productsSample || "(sem produtos)"}

Mais vendidos últimos 30 dias: ${ctx?.topSold?.length ? ctx.topSold.join(", ") : "(sem dados)"}
Pedidos no período: ${ctx?.totalOrders || 0} | Faturamento: R$${(ctx?.totalRevenue || 0).toFixed(2)}

Briefing extra do dono: ${body.extraContext || "(nenhum)"}.

Gere o conteúdo no formato pedido, usando produto real do catálogo quando fizer sentido.`;
}

// ===== Multi-provider fallback =====
async function tryGoogle(system: string, user: string, supabase: any): Promise<string | null> {
  const { data: keys } = await supabase
    .from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const all = keys?.length ? keys : (Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : []);
  for (const k of all) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k.api_key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: system }] },
            { role: "model", parts: [{ text: "Ok, pode mandar o briefing." }] },
            { role: "user", parts: [{ text: user }] },
          ],
        }),
      });
      if (r.status === 429 || r.status === 403) {
        if (k.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", k.id);
        continue;
      }
      if (!r.ok) continue;
      if (k.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch { continue; }
  }
  return null;
}

async function tryLovable(system: string, user: string): Promise<string | null> {
  const KEY = Deno.env.get("LOVABLE_API_KEY"); if (!KEY) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

async function tryOpenRouter(system: string, user: string): Promise<string | null> {
  const KEY = Deno.env.get("OPENROUTER_API_KEY"); if (!KEY) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

async function tryWorkers(system: string, user: string, supabase: any): Promise<string | null> {
  const { data: active } = await supabase.from("ai_workers")
    .select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers")
    .select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  const workers = [...(active || []), ...(exhausted || [])];
  for (const w of workers) {
    try {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-chat`;
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: user }], systemPrompt: system, tenantName: "marketing-post" }),
      });
      if (r.status === 429 || r.status === 402 || r.status === 503) {
        if (!w.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", w.id);
        continue;
      }
      if (!r.ok) continue;
      if (w.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", w.id);
      else await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let out = ""; let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const s = line.slice(6).trim(); if (!s || s === "[DONE]") continue;
          try { const p = JSON.parse(s); const c = p.choices?.[0]?.delta?.content; if (c) out += c; } catch {}
        }
      }
      if (out) return out;
    } catch { continue; }
  }
  return null;
}


async function tryLovableImage(fullPrompt: string): Promise<string | null> {
  const KEY = Deno.env.get("LOVABLE_API_KEY"); if (!KEY) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: fullPrompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!r.ok) {
      console.error("lovable image failed:", r.status, await r.text().catch(() => ""));
      return null;
    }
    const j = await r.json();
    return j.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
  } catch (e) { console.error("lovable image error:", e); return null; }
}

async function tryImageWorkers(fullPrompt: string, supabase: any): Promise<string | null> {
  const { data: active } = await supabase.from("ai_workers")
    .select("id, name, base_url")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "image")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers")
    .select("id, name, base_url")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "image")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  const workers = [...(active || []), ...(exhausted || [])];
  for (const w of workers) {
    try {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-generate-image`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, productName: "marketing-post", category: "marketing", tenantId: "marketing" }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (r.status === 429 || r.status === 402 || r.status === 503) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", w.id);
        continue;
      }
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) continue;
      const data = await r.json();
      let imageUrl: string | null = null;
      if (typeof data.imageUrl === "string" && data.imageUrl.length > 0) imageUrl = data.imageUrl;
      else if (typeof data.image === "string" && data.image.length > 0) imageUrl = data.image;
      else if (data.choices?.[0]?.message?.images?.[0]?.image_url?.url) imageUrl = data.choices[0].message.images[0].image_url.url;
      if (imageUrl) {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
        return imageUrl;
      }
    } catch (e) { console.warn("image worker error:", e instanceof Error ? e.message : e); continue; }
  }
  return null;
}

// Pede pra IA destilar uma cena visual concreta + escolher estilo
// Retorna { scene, style } onde scene é descrição em inglês e style é ImageStyle
async function distillImageScene(
  briefing: string,
  postText: string,
  niche: string | undefined,
  forcedStyle: ImageStyle,
  supabase: any
): Promise<{ scene: string; style: ImageStyle }> {
  const sys = `Você é um diretor de arte sênior + especialista em marketing digital.
Sua tarefa: ler o TEXTO DE UM POST de Instagram e descrever UMA imagem que faça TOTAL SENTIDO com aquele post específico.

REGRAS OBRIGATÓRIAS:
- A imagem DEVE refletir literalmente o que o post está vendendo/falando. Se o post fala de hambúrguer, mostre hambúrguer real. Se fala de chopp, mostre chopp gelado servido. Se fala de plataforma SaaS, mostre dono de loja feliz mexendo no celular vendo pedidos chegando, ou interface de loja online em tela.
- NUNCA descreva imagens abstratas/genéricas (cubos flutuantes, hologramas, "símbolos de tecnologia", "conceito abstrato de marketing").
- NUNCA inclua texto, letras, palavras, logotipos, números ou tipografia na imagem.
- Se forçaram estilo "${forcedStyle}", use exatamente esse. Se "auto", escolha entre: realistic (padrão pra comida/produto/loja), cartoon (pra promoção divertida/infantil), 3d (pra mascote/app/SaaS amigável), minimal (pra premium/sofisticado), vintage (pra bar/boteco retrô), anime (raro, só se pedirem vibe jovem otaku).

RESPONDA EM JSON puro (sem markdown, sem \`\`\`):
{"style":"realistic|cartoon|3d|minimal|vintage|anime","scene":"descrição visual em inglês, 1 frase, máx 60 palavras, cena fotografável e literal"}`;

  const usr = `Nicho da loja: ${niche || "negócio local"}
Briefing: ${briefing}

TEXTO DO POST (a imagem precisa CASAR com isso):
${postText.slice(0, 800)}

Estilo solicitado pelo usuário: ${forcedStyle}

Responda só o JSON.`;

  for (const fn of [tryGoogle, tryLovable, tryOpenRouter, tryWorkers] as const) {
    try {
      // @ts-ignore
      const r = await fn(sys, usr, supabase);
      if (!r) continue;
      const cleaned = r.replace(/```json|```/g, "").trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const parsed = JSON.parse(m[0]);
      if (parsed?.scene) {
        const style = (forcedStyle !== "auto" ? forcedStyle : (parsed.style as ImageStyle)) || "realistic";
        return { scene: String(parsed.scene).trim(), style: STYLE_DIRECTIVES[style] ? style : "realistic" };
      }
    } catch (e) { console.warn("distill fail:", e instanceof Error ? e.message : e); continue; }
  }
  return { scene: briefing, style: forcedStyle === "auto" ? "realistic" : forcedStyle };
}

// Política do dono: imagem sempre pelos Workers/cascata de APIs, nunca Pollinations (qualidade ruim).

async function generatePostImage(briefing: string, postText: string, niche: string | undefined, forcedStyle: ImageStyle, supabase: any): Promise<string | null> {
  const { scene, style } = await distillImageScene(briefing, postText, niche, forcedStyle, supabase);
  console.log(`[marketing-post] image style=${style} scene=${scene}`);
  const styleLine = STYLE_DIRECTIVES[style];
  const fullPrompt = `Square 1:1 image for an Instagram post.
Subject: ${scene}
${styleLine}
Composition: hero subject centered or rule-of-thirds, clean readable background, social-media ready.`;
  const res = await generateImageCascade(supabase, fullPrompt, "marketing", "post");
  if (!res) console.error("[marketing-post] cascata de imagem falhou, prompt:", fullPrompt.slice(0, 150));
  return res?.url ?? null;
}

export async function post(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json() as Body;
    if (!body?.format || !body?.scope) {
      return new Response(JSON.stringify({ error: "scope e format obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = getSupabase();
    let ctx: any = null;
    if (body.scope === "tenant") {
      if (!body.tenantId) return new Response(JSON.stringify({ error: "tenantId obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      ctx = await gatherTenantContext(supabase, body.tenantId);
    }
    const system = buildSystemPrompt(body.format, body.tone);
    const user = buildUserPrompt(body, ctx);

    let content: string | null = null;
    for (const fn of [tryGoogle, tryLovable, tryOpenRouter, tryWorkers] as const) {
      // @ts-ignore signature compat
      content = await fn(system, user, supabase);
      if (content) break;
    }
    if (!content) {
      return new Response(JSON.stringify({ error: "Todos os provedores de texto falharam" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let imageDataUrl: string | null = null;
    if (body.generateImage) {
      const imgPrompt = body.imagePrompt?.trim()
        || (ctx?.tenant ? `${ctx.tenant.name} — ${ctx.tenant.niche || "negócio local"}` : `Plataforma SaaS de delivery brasileira. ${(body.extraContext || "").slice(0, 200)}`);
      const niche = ctx?.tenant?.niche || (body.scope === "platform" ? "saas delivery platform" : undefined);
      imageDataUrl = await generatePostImage(imgPrompt, content || "", niche, body.imageStyle || "auto", supabase);
    }

    // ===== Overlay de arte (para o compositor do feed oficial @smarthubly no frontend)
    // Gera título/subtítulo DIRETOS pela IA (título de impacto de até 7 palavras + subtítulo explicativo),
    // em vez de derivar da legenda (que costuma sair genérica). mode é fixo editorial_overlay.
    const ovSys = `Você é redator-chefe de um perfil premium de Instagram (@smarthubly — estética editorial navy/dourado).
Sua única tarefa: ler o texto de um post e criar o TÍTULO da arte (tipografia serif, 4 a 7 palavras, afirmação forte e direta, NUNCA começa com "Aqui está/Apresentando/Segue/Olha" — proibido se auto-referenciar) e um SUBTÍTULO curto (1 frase de no máx 18 palavras que explica/expande o título, sem emoji e sem link).
O título precisa funcionar sozinho impresso em cima de uma foto — como manchete de revista.
Exemplos bons: "Seu lucro não é do iFood", "Chapa ligada, caixa cheio", "Venda direto do seu balcão", "A loja online que você não tinha", "Hamburgueria de bairro, padrão de elite".
Responda apenas JSON puro (sem markdown, sem \`\`\`):
{"title":"título de impacto até 7 palavras","subtitle":"subtítulo de no máx 18 palavras"}`;
    const ovUsr = `Texto do post:
${(content || "").slice(0, 600)}

Assunto/negócio: ${body.scope === "tenant" && ctx?.tenant ? `${ctx.tenant.name} — ${ctx.tenant.niche || "negócio local"}` : `Plataforma SaaS de delivery/lojas online pra pequenos comerciantes brasileiros. ${(body.extraContext || "").slice(0, 200)}`}

Responda só o JSON.`;
    let ovTitle = "", ovSub = "";
    for (const fn of [tryGoogle, tryLovable, tryOpenRouter, tryWorkers] as const) {
      // @ts-ignore signature compat
      const ov = await fn(ovSys, ovUsr, supabase);
      if (!ov) continue;
      const cleaned = ov.replace(/```json|```/g, "").trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const p = JSON.parse(m[0]);
          ovTitle = String(p.title || "").trim();
          ovSub = String(p.subtitle || p.sub || "").trim();
          if (ovTitle && ovSub) break;
        } catch { continue; }
      }
    }
    if (!ovTitle) {
      // fallback: primeira frase forte da própria legenda
      const first = (content || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.length > 8)[0] || "";
      ovTitle = first.slice(0, 45);
      ovSub = "";
    }
    const overlay = body.generateImage && imageDataUrl
      ? { mode: "editorial_overlay", style: body.imageStyle || "auto", title1: ovTitle, title2: "", subtitle: ovSub.slice(0, 160) }
      : null;

    const resData: Record<string, unknown> = {
      content,
      image: imageDataUrl,
      overlay,
      context_used: ctx ? { topSold: ctx.topSold, totalOrders: ctx.totalOrders, tenantName: ctx.tenant?.name } : null,
    };

    return new Response(JSON.stringify(resData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  } catch (e) {
    console.error("[unified:post] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
