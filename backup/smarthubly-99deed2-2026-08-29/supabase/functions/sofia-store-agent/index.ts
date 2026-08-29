// Sofia Agente de Loja — Edge Function
// Autonomia guiada: a IA gera um PLANO (paleta, textos, preços, fotos) sem alterar nada,
// o lojista revisa/aprova, e só então o /apply executa as mudanças com snapshot para rollback.
//
// Endpoints:
//   POST /plan    { tenantId, messages }  → gera plano JSON, salva status=pending
//   POST /plans   GET  { tenantId }       → lista planos
//   POST /apply   { planId }              → aplica plano aprovado (executa diffs + gera fotos)
//   POST /rollback { planId }             → reverte com snapshot_before
//
// Auth: JWT do lojista (Bearer publishable key do browser) validado via auth.getUser +
// has_role(admin, tenant) ou super_admin. Custos zero: fallback IA já embutido (_shared/ai-fallback).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callAiJson } from "../_shared/ai-fallback.ts";
import { generateImageCascade } from "../_shared/image-gen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdmin(supabaseUrl: string, key: string) {
  return createClient(supabaseUrl, key);
}

// ============ AUTH ============
// Valida o JWT do caller e garante que ele é admin da tenant (ou super admin).
// Padrão da plataforma (cindy): cliente anônimo com o JWT do caller pra validar a sessão.
async function requireTenantAdmin(admin: any, authHeader: string | null, tenantId: string): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
  const token = authHeader.slice(7);
  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: session, error } = await callerClient.auth.getUser();
  if (error || !session?.user) throw new Error("unauthorized");
  const userId = session.user.id;

  // Super admin passa direto
  const { data: superRow } = await admin
    .from("platform_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (superRow) return userId;

  // Lojista admin da tenant
  const { data: roleRow } = await admin
    .from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId)
    .eq("role", "admin").eq("approved", true).maybeSingle();
  if (!roleRow) throw new Error("forbidden_tenant");
  return userId;
}

// ============ CONTEXTO DA LOJA ============
interface StoreContext {
  tenant: any;
  products: any[];
  summary: string;
}

async function buildStoreContext(admin: any, tenantId: string): Promise<StoreContext> {
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("id, name, slug, niche, description, brand_primary_color, brand_bg_color, splash_bg_color, show_description, show_title, catalog_layout")
    .eq("id", tenantId).single();
  if (tErr || !tenant) throw new Error("tenant_not_found");

  const { data: products, error: pErr } = await admin
    .from("products")
    .select("id, name, description, price, original_price, category, subcategory, image, in_stock")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(120);
  if (pErr) throw pErr;

  const summary = [
    `Loja: ${tenant.name} (slug: ${tenant.slug}, nicho: ${tenant.niche || "não definido"})`,
    `Paleta atual: primary=${tenant.brand_primary_color || "?"} bg=${tenant.brand_bg_color || "?"} splash=${tenant.splash_bg_color || "?"}`,
    `Descrição atual: ${tenant.description || "(vazia)"}`,
    `Descrição visível: ${tenant.show_description !== false ? "sim" : "não"} | Título visível: ${tenant.show_title !== false ? "sim" : "não"}`,
    `Layout: ${tenant.catalog_layout || "grid"} | Produtos: ${products.length}`,
    `Produtos (top 120 por cadastro):`,
    ...(products || []).slice(0, 80).map((p: any) =>
      `- [${p.id}] "${p.name}" | R$${Number(p.price).toFixed(2)}${p.original_price ? ` (de R$${Number(p.original_price).toFixed(2)})` : ""} | cat: ${p.category || "—"}/${p.subcategory || "—"} | ${p.in_stock ? "em estoque" : "esgotado"} | imagem: ${p.image ? "sim" : "NÃO"}`,
    ),
  ].join("\n");

  return { tenant, products: products || [], summary };
}

// ============ GERAÇÃO DE IMAGEM ============
// Cascata profissional (sem Pollinations): Google Gemini 2.5 Flash Image → Lovable AI → ai_workers (image)
// Política do dono: imagem sempre pelos Workers/cascata de APIs, nunca Pollinations (qualidade ruim).
async function generateAndUploadImage(admin: any, prompt: string, tenantId: string, productName?: string): Promise<{ url: string | null; err: string | null }> {
  try {
    const res = await generateImageCascade(admin, prompt, tenantId, "sofia", { productName });
    if (res?.url) return { url: res.url, err: null };
    console.error("[sofia] cascata retornou null — workers/google/lovable todos falharam, prompt:", (prompt || "").slice(0, 60));
    return { url: null, err: "cascata de imagem falhou em todos os estagios (prompt: " + (prompt || "").slice(0, 80) + ")" };
  } catch (e) {
    return { url: null, err: e instanceof Error ? e.message : String(e) };
  }
}

// ============ APLICAÇÃO DO PLANO ============
// Plano: { tenantChanges, productChanges[], notes, rationale }
// tenantChanges: { brand_primary_color?, brand_bg_color?, splash_bg_color?, description?, show_description?, show_title? }
// productChanges: [ { id, newName?, newDescription?, newPrice?, newImagePrompt? } ]

async function applyPlan(admin: any, plan: any, tenantId: string, opts?: { onlyImages?: boolean }): Promise<{ applied: string[]; errors: string[] }> {
  const applied: string[] = [];
  const errors: string[] = [];

  const pc = (plan?.productChanges || []).filter((x: any) => x?.id);
  // onlyImage=true → gera SOMENTE as imagens (usado pelo retry), sem tocar em identidade/nome/preço/descrição
  const onlyImages = Boolean(opts?.onlyImages);
  if (onlyImages) {
    const imageResults = await Promise.allSettled(
      pc.map(async (item) => {
        if (!item.newImagePrompt) return { id: item.id, url: null };
        const r = await generateAndUploadImage(admin, item.newImagePrompt, tenantId, item.productName);
        return { id: item.id, url: r.url, err: r.err };
      }),
    );
    const byId = new Map(imageResults.map((r, i) => [pc[i].id, r.status === "fulfilled" ? r.value : null]));
    for (const item of pc) {
      if (!item.newImagePrompt) continue;
      const rec = byId.get(item.id);
      const imageUrl = rec?.url || null;
      if (!imageUrl) errors.push(`foto do produto ${item.id}: ${rec?.err ?? "geração falhou"}`);
      else {
        const { error } = await admin.from("products").update({ image: imageUrl }).eq("id", item.id).eq("tenant_id", tenantId);
        if (error) errors.push(`foto do produto ${item.id}: ${error.message}`);
        else applied.push(`foto do produto ${item.id}`);
      }
    }
    return { applied, errors };
  }

  const tc = plan?.tenantChanges || {};
  const tenantKeys = Object.keys(tc);
  if (tenantKeys.length > 0) {
    const safe: Record<string, unknown> = {};
    for (const k of tenantKeys) {
      if (["brand_primary_color", "brand_bg_color", "splash_bg_color", "description", "show_description", "show_title"].includes(k)) {
        safe[k] = tc[k];
      }
    }
    if (Object.keys(safe).length > 0) {
      const { error } = await admin.from("tenants").update(safe).eq("id", tenantId);
      if (error) errors.push(`tenants: ${error.message}`);
      else applied.push(`identidade (${Object.keys(safe).join(", ")})`);
    }
  }

  // Gera todas as imagens EM PARALELO (evita esgotar o compute da Edge Function)
  const imageResults = await Promise.allSettled(
    pc.map(async (item) => {
      if (!item.newImagePrompt) return { id: item.id, url: null };
      const r = await generateAndUploadImage(admin, item.newImagePrompt, tenantId, item.productName);
      return { id: item.id, url: r.url, err: r.err };
    }),
  );
  const byId = new Map(imageResults.map((r, i) => [pc[i].id, r.status === "fulfilled" ? r.value : null]));

  for (const item of pc) {
    try {
      const rec = byId.get(item.id);
      const imageUrl = rec?.url || null;
      if (onlyImages) {
        if (!item.newImagePrompt) continue;
        if (!imageUrl) errors.push(`foto do produto ${item.id}: ${rec?.err ?? "geração falhou"}`);
        else {
          const { error } = await admin.from("products").update({ image: imageUrl }).eq("id", item.id).eq("tenant_id", tenantId);
          if (error) errors.push(`foto do produto ${item.id}: ${error.message}`);
          else applied.push(`foto do produto ${item.id}`);
        }
        continue;
      }
      // apply completo: atualiza tudo exceto imagem já aplicada antes (evita regravar)
      if (item.newImagePrompt) {
        if (imageUrl) applied.push(`foto do produto ${item.id}`);
        else errors.push(`foto do produto ${item.id}: ${rec?.err ?? "geração falhou (resto aplicado)"}`);
      }
      const update: Record<string, unknown> = {};
      if (imageUrl) update.image = imageUrl;
      if (item.newName != null && String(item.newName).trim()) update.name = String(item.newName).trim();
      if (item.newDescription != null) update.description = String(item.newDescription);
      if (typeof item.newPrice === "number" && isFinite(item.newPrice) && item.newPrice >= 0) {
        update.price = Math.round(item.newPrice * 100) / 100;
      }
      if (Object.keys(update).length > 0) {
        const { error } = await admin.from("products").update(update).eq("id", item.id).eq("tenant_id", tenantId);
        if (error) errors.push(`produto ${item.id}: ${error.message}`);
        else applied.push(`produto ${item.id}`);
      }
    } catch (e) {
      errors.push(`produto ${item.id}: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  return { applied, errors };
}

// ============ HANDLER ============
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // O frontend chama via supabase.functions.invoke (rota única), passando a ação no body._path.
    let path = "";
    let method = req.method;
    let body: any = null;
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = null; }
      if (body && body?._path) {
        path = String(body._path);
      } else if (body && body?.action) {
        // compat: action=list → plans
        path = body.action === "list" ? "plans" : "";
      }
    }
    if (!path) {
      const url = new URL(req.url);
      path = url.pathname.split("/").pop() || "";
    }
    if (method === "POST" && !body) body = (await req.json().catch(() => null)) || {};

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = getAdmin(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");

    if (path === "plan" && method === "POST") {
      const { tenantId, messages } = body as { tenantId?: string; messages?: any[] };
      if (!tenantId || !Array.isArray(messages) || messages.length === 0) {
        return json({ error: "tenantId e messages são obrigatórios" }, 400);
      }
      const userId = await requireTenantAdmin(admin, authHeader, tenantId);

      const ctx = await buildStoreContext(admin, tenantId);
      const lastMsg = [...messages].reverse().find((m: any) => m?.role === "user")?.content || "";

      // ===== FERRAMENTA: PROSPECÇÃO REAL =====
      // Se o pedido pedir para ACHAR empresas/clientes em uma cidade (prospecção),
      // executa a prospecção real via EF prospect-google-search e devolve os leads.
      const prospectRe = /\b(ache|encontr|prospect|busc|liste|monte uma lista de|empresas que precisam|empresas que compram|potenciais clientes|negócio[s]? em|clientes em)\b/i;
      const cityRe = /\b(belo horizonte|bh|são paulo|rio de janeiro|contagem|betim|betim|uberlândia|londrina|curitiba|salvador|recife|fortaleza|manaus|porto alegre|florianópolis|campinas|goiânia|niterói|juiz de fora|vila velha|serra|itabira|ituiutaba|uberaba|montes claros|sete lagoas|divinópolis|poços de caldas|pouso alegre|patos de minas|caxias do sul|pelotas|cascavel|maringá|foz do iguaçu|guarulhos|osasco|santo andré|são bernardo|são josé dos campos|ribeirão preto|sorocaba|niterói|são gonçalo|duque de caxias|nova iguaçu|belford roxo|petrópolis|volta redonda|campos dos goytacazes|são joão de meriti)\b/gi;
      if (prospectRe.test(lastMsg)) {
        try {
          // Extrai cidade e nicho com ajuda da IA
          const route: any = await callAiJson(admin, {
            systemPrompt: "Você é um roteador. Extraia de um pedido de prospecção: city (cidade principal, normalize: Belo Horizonte, São Paulo, Rio de Janeiro etc; se for 'BH' use 'Belo Horizonte'), state (UF da cidade, ex MG, SP, RJ), niche (o tipo de negócio procurado, ex 'distribuidora de laticínios', 'pizzaria', 'conveniência', 'supermercado'), neighborhood (bairro, se citado), sector (segmento de atuação do lojista, se citado). Responda só JSON.",
            userPrompt: `PEDIDO: "${lastMsg}"
Loja do lojista: ${ctx.summary}
Retorne: {"city":"","state":"","niche":"","neighborhood":"","sector":"","query":"frase curta da busca"}`,
            temperature: 0.3,
            maxTokens: 600,
          });
          let pCity = String(route?.city || "").trim();
          if (!pCity) {
            // Tenta pegar a cidade do próprio pedido via IA (a store context não tem cidade)
            const cityOnly: any = await callAiJson(admin, {
              systemPrompt: "Diga em que CIDADE o lojista quer achar clientes. Responda só JSON: {\"city\":\"\",\"state\":\"\"} (normalize ex: Belo Horizonte MG). Se o pedido não mencionar cidade, deixe vazio.",
              userPrompt: `PEDIDO: "${lastMsg}"`,
              temperature: 0.3,
              maxTokens: 200,
            });
            pCity = String(cityOnly?.city || "").trim();
            if (pCity && !String(route?.state || "").trim()) {
              const st = String(cityOnly?.state || "").trim().toUpperCase();
              route.state = st;
            }
          }
          if (!pCity) {
            return json({
              prospecting: true,
              query: "",
              city: "",
              state: "",
              inserted: 0,
              leads: [],
              status: "needs_city",
              message: "Entendi, você quer achar clientes! Mas não identifiquei a CIDADE no pedido. Me fala a cidade (ex: \"ache pizzarias em Belo Horizonte\") que eu já executo a prospecção.",
            });
          }
          const pState = String(route?.state || "").trim().toUpperCase();
          const pNiche = String(route?.niche || "").trim();
          const pNb = String(route?.neighborhood || "").trim();
          const pSector = String(route?.sector || "").trim();

          // Chama a EF de prospecção real com a sessão do usuário (super admin: leads ficam globais; lojista: ficam no tenant dele)
          const pAuth = authHeader;
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/prospect-google-search?apikey=${encodeURIComponent(anonKey)}`, {
            method: "POST",
            headers: {
              Authorization: pAuth || "",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              city: pCity,
              state: pState,
              niche: pNiche,
              neighborhood: pNb || undefined,
              sector: pSector || undefined,
              tenantId,
            }),
          });
          const pRes = await r.json().catch(() => ({}));
          if (pRes?.error) throw new Error(pRes.error);
          const pLeads: any[] = pRes?.leads || [];
          return json({
            prospecting: true,
            query: pRes?.query || String(route?.query || ""),
            city: pCity,
            state: pState,
            inserted: pRes?.inserted || 0,
            leads: pLeads.map((l: any) => ({
              id: l.id,
              business_name: l.business_name,
              category: l.category,
              neighborhood: l.neighborhood,
              address: l.address,
              city: l.city,
              state: l.state,
              phone: l.phone,
              whatsapp: l.whatsapp,
              email: l.email,
              website_url: l.website_url,
              instagram_handle: l.instagram_handle,
              maps_url: l.maps_url,
              rating: l.rating,
              reviews_count: l.reviews_count,
              priority_score: l.priority_score,
              source: l.scrape_source || l.source,
            })),
            status: "applied",
            message: pLeads.length
              ? `Prospecção concluída! Achei ${pLeads.length} empresas em ${pCity}${pState ? ", " + pState : ""}. Os leads já estão salvos na sua aba Prospecção Remota — vá lá ver e chamar no WhatsApp.`
              : "Busquei mas não achei empresas com esses termos nessa região. Tente um termo mais comum (ex: 'pizzaria', 'conveniência') ou outra cidade.",
          });
        } catch (e) {
          // Falha na prospecção: cai de volta para o plano de loja explicando o que acontece
          console.error("[sofia] prospecção falhou:", e);
        }
      }

      const SYSTEM = `Você é a SOFIA AGENTE DE LOJA — agente autônomo de repaginação de lojas da plataforma SmartHubly.
SUA MISSÃO: transformar a loja do lojista a partir do pedido dele (linguagem natural), devolvendo SEMPRE um PLANO estruturado JSON.
O plano NÃO altera nada — ele será revisado e aprovado pelo lojista antes da aplicação.

REGRAS DE ROTEAMENTO (o lojista pode pedir OUTRAS coisas além de loja):
- Se o pedido for sobre ACHAR EMPRESAS/CLIENTES em alguma cidade (ex: "ache empresas que precisam de laticínios em Belo Horizonte", "prospecta restaurantes em BH"), a Sofia já executa a prospecção sozinha — NÃO trate isso como pedido de repaginação. Responda o JSON padrão com prospecting: true, query (frase da busca), city, state e leads (lista de empresas encontradas com nome, bairro, endereço, telefone, site, instagram, maps, score). Se não souber a cidade, pergunte em rationale. Não invente leads: os leads vêm da ferramenta de prospecção real executada antes.

CONTEXTO REAL DA LOJA (dados ao vivo do banco):
${ctx.summary}

REGRAS DO PLANO JSON:
1. Responda APENAS com JSON válido nesta estrutura exata:
{
  "rationale": "2-3 frases em PT-BR explicando as escolhas",
  "prospecting": true/false,
  "query": "frase curta da busca", "city": "", "state": "", "leads": [ {"business_name":"","neighborhood":"","address":"","phone":"","whatsapp":"","email":"","website_url":"","instagram_handle":"","maps_url":"","rating":0,"reviews_count":0,"priority_score":0,"source":""} ],
  "tenantChanges": { "brand_primary_color": "#RRGGBB", "brand_bg_color": "#RRGGBB", "splash_bg_color": "#RRGGBB", "description": "string", "show_description": true/false, "show_title": true/false },
  "productChanges": [ { "id": "uuid do produto", "newName": "...", "newDescription": "...", "newPrice": 0.00, "newImagePrompt": "prompt em INGLÊS para gerar foto editorial fotorrealista do produto" } ]
}
2. CAMPOS DE tenantChanges: só inclua os que precisam MUDAR. Cores devem ser hex "#RRGGBB".
   - Paleta: use psicologia das cores + nicho da loja. Para eletrônicos/celulares/tecnologia prefira tons modernos e tecnológicos (azul petróleo ex: #0E7490/#134E4A, grafite ex: #262626/#404040, roxo moderno ex: #6D28D9) — evite cores pálidas "infantis". Fundo claro funciona bem na maioria dos casos varejo; escuro só pra nicho noturno/premium.
   - description: textos de vitrine curtos (1 frase), elegantes, vendem o estilo da loja. NUNCA mencione "delivery" como limitação.
3. productChanges: só inclua produtos que precisam mudar.
   - newPrice: ajuste com lógica de mercado — preserve margem (use original_price quando existir como âncora), preços "premium" +10~25%, "competitivo" -5~15%, nunca zere e nunca crie preço negativo.
   - newImagePrompt: escreva em INGLÊS, estilo "editorial product photography", fotorrealista, 8k, sem texto/labels/watermark. Inclua o nome do produto e contexto coerente com o nicho.
4. Se o lojista pedir só UMA coisa (ex: só paleta ou só prospecção), não invente mudanças em outros campos.
5. Jamais invente produtos que não estão no contexto. Use apenas os IDs listados.
6. Jamais INVENTE leads de empresas — leads só existem se a ferramenta de prospecção trouxe. Se não houver prospecção no pedido, leads deve ser lista vazia [].
7. Responda só o JSON, sem markdown, sem comentários.`;

      const userPrompt = `PEDIDO DO LOJISTA: "${lastMsg}"

Responda apenas com o JSON do plano. Produtos com imagem faltando e visíveis na loja são candidatos a newImagePrompt.`;

      let plan: any;
      try {
        plan = await callAiJson(admin, {
          systemPrompt: SYSTEM,
          userPrompt,
          temperature: 0.7,
          maxTokens: 4000,
        });
      } catch (e) {
        return json({ error: "ai_unavailable", detail: e instanceof Error ? e.message : "IA indisponível no momento" }, 503);
      }

      // Sanitiza: garante estrutura e valida tenantChanges
      const safePlan = {
        rationale: String(plan?.rationale || ""),
        tenantChanges: (typeof plan?.tenantChanges === "object" && plan.tenantChanges) || {},
        productChanges: Array.isArray(plan?.productChanges)
          ? plan.productChanges.map((p: any) => ({
              id: String(p?.id || ""),
              newName: p?.newName != null ? String(p.newName) : undefined,
              newDescription: p?.newDescription != null ? String(p.newDescription) : undefined,
              newPrice: typeof p?.newPrice === "number" ? p.newPrice : undefined,
              newImagePrompt: p?.newImagePrompt != null ? String(p.newImagePrompt) : undefined,
              // productName ancora o tema da imagem no worker (evita fotos genéricas)
              productName: p?.productName != null ? String(p.productName).slice(0, 40)
                : String(p?.newName || ctx.products.find((x: any) => x.id === String(p?.id))?.name || "").slice(0, 40) || undefined,
            })).filter((p: any) => p.id)
          : [],
        userRequest: lastMsg,
      };

      // Snapshot antes de aplicar (para rollback)
      const snapshotBefore: any = {
        tenant: {
          brand_primary_color: ctx.tenant.brand_primary_color,
          brand_bg_color: ctx.tenant.brand_bg_color,
          splash_bg_color: ctx.tenant.splash_bg_color,
          description: ctx.tenant.description,
          show_description: ctx.tenant.show_description,
          show_title: ctx.tenant.show_title,
        },
        products: (safePlan.productChanges as any[])
          .filter((p) => p.newPrice != null || p.newName != null || p.newDescription != null)
          .map((p: any) => {
            const orig = ctx.products.find((x: any) => x.id === p.id);
            return orig
              ? { id: orig.id, name: orig.name, description: orig.description, price: orig.price, image: orig.image }
              : null;
          }).filter(Boolean),
      };

      const { data: planRow, error: planErr } = await admin
        .from("store_agent_plans")
        .insert({
          tenant_id: tenantId,
          user_id: userId,
          user_request: lastMsg,
          plan: safePlan,
          snapshot_before: snapshotBefore,
          status: "pending",
        })
        .select("id")
        .single();
      if (planErr) throw planErr;

      const autoApply = Boolean((body as { autoApply?: boolean })?.autoApply);
      let applyResult: { applied: string[]; errors: string[] } | null = null;
      if (autoApply) {
        const { applied, errors } = await applyPlan(admin, safePlan, tenantId);
        await admin.from("store_agent_plans").update({
          status: applied.length > 0 ? "applied" : "failed",
          applied_by: userId,
          applied_at: new Date().toISOString(),
          snapshot_after: { applied, errors },
        }).eq("id", planRow.id);
        applyResult = { applied, errors };
      }

      return json({
        planId: planRow.id,
        rationale: safePlan.rationale,
        tenantChanges: safePlan.tenantChanges,
        productChanges: safePlan.productChanges,
        status: applyResult ? (applyResult.applied.length > 0 ? "applied" : "failed") : "pending",
        applied: applyResult?.applied,
        errors: applyResult?.errors,
        message: applyResult
          ? (applyResult.applied.length > 0
              ? `Aplicado direto! ${applyResult.applied.length} mudança(s) na sua loja. Recarregue a loja para ver.`
              : "Nada foi aplicado — verifique os erros.")
          : "Plano pronto! Revise abaixo e toque em APLICAR quando aprovar.",
      });
    }

    if ((path === "plans" || path === "plan-detail") && method === "POST") {
      const { tenantId, planId } = body as { tenantId?: string; planId?: string };
      if (!tenantId) return json({ error: "tenantId obrigatório" }, 400);
      if (path === "plan-detail") {
        if (!planId) return json({ error: "planId obrigatório" }, 400);
        const { data: row, error: fErr } = await admin
          .from("store_agent_plans").select("id, status, user_request, plan, snapshot_before").eq("id", planId).eq("tenant_id", tenantId).single();
        if (fErr || !row) return json({ error: "plano_nao_encontrado" }, 404);
        await requireTenantAdmin(admin, authHeader, tenantId);
        return json({ plan: row.plan, status: row.status, userRequest: row.user_request });
      }
      await requireTenantAdmin(admin, authHeader, tenantId);
      const { data, error } = await admin
        .from("store_agent_plans")
        .select("id, status, user_request, rationale, created_at, applied_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return json({ plans: data || [] });
    }

    if (path === "apply" && method === "POST") {
      const { planId } = body as { planId?: string };
      if (!planId) return json({ error: "planId obrigatório" }, 400);
      const { data: planRow, error: fErr } = await admin
        .from("store_agent_plans").select("*").eq("id", planId).single();
      if (fErr || !planRow) return json({ error: "plano_nao_encontrado" }, 404);
      const userId = await requireTenantAdmin(admin, authHeader, planRow.tenant_id);
      if (planRow.status === "applied") return json({ error: "plano_ja_aplicado" }, 409);

      const { applied, errors } = await applyPlan(admin, planRow.plan, planRow.tenant_id);
      const status = applied.length > 0 ? "applied" : "failed";
      await admin.from("store_agent_plans").update({
        status,
        applied_by: userId,
        applied_at: new Date().toISOString(),
        snapshot_after: { applied, errors },
      }).eq("id", planId);

      return json({ status, applied, errors, message:
        status === "applied"
          ? `Aplicado! ${applied.length} mudança(s) na sua loja. Recarregue a loja para ver.`
          : "Nada foi aplicado — verifique os erros."
      });
    }

    if (path === "rollback" && method === "POST") {
      const { planId } = body as { planId?: string };
      if (!planId) return json({ error: "planId obrigatório" }, 400);
      const { data: planRow, error: fErr } = await admin
        .from("store_agent_plans").select("*").eq("id", planId).single();
      if (fErr || !planRow) return json({ error: "plano_nao_encontrado" }, 404);
      await requireTenantAdmin(admin, authHeader, planRow.tenant_id);
      if (planRow.status !== "applied") return json({ error: "plano_nao_aplicado" }, 409);

      const sb = planRow.snapshot_before || {};
      const restored: string[] = [];
      const errs: string[] = [];
      if (sb.tenant) {
        const { error } = await admin.from("tenants").update(sb.tenant).eq("id", planRow.tenant_id);
        if (error) errs.push(`tenants: ${error.message}`);
        else restored.push("identidade da loja");
      }
      for (const p of sb.products || []) {
        const { error } = await admin
          .from("products").update({ name: p.name, description: p.description, price: p.price, image: p.image })
          .eq("id", p.id).eq("tenant_id", planRow.tenant_id);
        if (error) errs.push(`produto ${p.id}`);
        else restored.push(`produto ${p.name}`);
      }
      await admin.from("store_agent_plans").update({
        status: "rolled_back",
        rolled_back_at: new Date().toISOString(),
      }).eq("id", planId);

      return json({ status: "rolled_back", restored, errors: errs, message:
        errs.length ? "Reversão parcial. Algo falhou — verifique." : "Tudo revertido com sucesso!"
      });
    }

    if (path === "retry-images" && method === "POST") {
      const { planId } = body as { planId?: string };
      if (!planId) return json({ error: "planId obrigatório" }, 400);
      const { data: planRow, error: fErr } = await admin
        .from("store_agent_plans").select("*").eq("id", planId).single();
      if (fErr || !planRow) return json({ error: "plano_nao_encontrado" }, 404);
      await requireTenantAdmin(admin, authHeader, planRow.tenant_id);
      if (planRow.status !== "applied") return json({ error: "plano_nao_aplicado" }, 409);
      const { applied, errors } = await applyPlan(admin, planRow.plan, planRow.tenant_id, { onlyImages: true });
      await admin.from("store_agent_plans").update({
        snapshot_after: { ...(planRow.snapshot_after || {}), retry: { applied, errors } },
      }).eq("id", planId);
      return json({ applied, errors, message: errors.length
        ? `Parcial: ${applied.length} foto(s) regenerada(s).`
        : `Fotos regeneradas com sucesso: ${applied.length}` });
    }

    return json({ error: "rota desconhecida", paths: ["plan", "plans", "apply", "rollback", "retry-images"] }, 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    console.error("[sofia-store-agent]", e);
    const statusMap: Record<string, number> = {
      unauthorized: 401, forbidden_tenant: 403, tenant_not_found: 404,
      plano_nao_encontrado: 404, plano_ja_aplicado: 409, plano_nao_aplicado: 409,
    };
    return json({ error: msg }, statusMap[msg] || 500);
  }
});
