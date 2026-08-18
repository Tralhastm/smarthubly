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
// Pollinations.ai gratuita (sem chave) → baixa bytes → sobe pro bucket product-images → URL pública
async function generateAndUploadImage(admin: any, prompt: string, tenantId: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${Math.floor(Math.random() * 1e9)}`;
    const r = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!r.ok || !r.headers.get("content-type")?.includes("image")) return null;
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Converte para base64 via chunking (Deno btoa limita a strings pequenas)
    let bin = "";
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const mime = r.headers.get("content-type")?.startsWith("image/png") ? "image/png" : "image/jpeg";
    const ext = mime === "image/png" ? "png" : "jpg";
    const path = `${tenantId}/${crypto.randomUUID()}-sofia.${ext}`;
    const { error } = await admin.storage.from("product-images").upload(path, bytes, { contentType: mime, upsert: true });
    if (error) return null;
    const { data: urlData } = admin.storage.from("product-images").getPublicUrl(path);
    return urlData.publicUrl;
  } catch (e) {
    console.warn("[sofia-agent] image gen failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ============ APLICAÇÃO DO PLANO ============
// Plano: { tenantChanges, productChanges[], notes, rationale }
// tenantChanges: { brand_primary_color?, brand_bg_color?, splash_bg_color?, description?, show_description?, show_title? }
// productChanges: [ { id, newName?, newDescription?, newPrice?, newImagePrompt? } ]

async function applyPlan(admin: any, plan: any, tenantId: string): Promise<{ applied: string[]; errors: string[] }> {
  const applied: string[] = [];
  const errors: string[] = [];

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

  const pc = plan?.productChanges || [];
  for (const item of pc) {
    if (!item?.id) continue;
    try {
      let imageUrl: string | null = null;
      if (item.newImagePrompt) {
        imageUrl = await generateAndUploadImage(admin, item.newImagePrompt, tenantId);
        if (imageUrl) applied.push(`foto do produto ${item.id}`);
        else errors.push(`foto do produto ${item.id}: geração falhou (ignorada, resto aplicado)`);
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

      const SYSTEM = `Você é a SOFIA AGENTE DE LOJA — agente autônomo de repaginação de lojas da plataforma SmartHubly.
SUA MISSÃO: transformar a loja do lojista a partir do pedido dele (linguagem natural), devolvendo SEMPRE um PLANO estruturado JSON.
O plano NÃO altera nada — ele será revisado e aprovado pelo lojista antes da aplicação.

CONTEXTO REAL DA LOJA (dados ao vivo do banco):
${ctx.summary}

REGRAS DO PLANO JSON:
1. Responda APENAS com JSON válido nesta estrutura exata:
{
  "rationale": "2-3 frases em PT-BR explicando as escolhas",
  "tenantChanges": { "brand_primary_color": "#RRGGBB", "brand_bg_color": "#RRGGBB", "splash_bg_color": "#RRGGBB", "description": "string", "show_description": true/false, "show_title": true/false },
  "productChanges": [ { "id": "uuid do produto", "newName": "...", "newDescription": "...", "newPrice": 0.00, "newImagePrompt": "prompt em INGLÊS para gerar foto editorial fotorrealista do produto" } ]
}
2. CAMPOS DE tenantChanges: só inclua os que precisam MUDAR. Cores devem ser hex "#RRGGBB".
   - Paleta: use psicologia das cores + nicho da loja. Fundo claro na maioria dos casos varejo; escuro só pra nicho noturno/premium.
   - description: textos de vitrine curtos (1 frase), elegantes, vendem o estilo da loja. NUNCA mencione "delivery" como limitação.
3. productChanges: só inclua produtos que precisam mudar.
   - newPrice: ajuste com lógica de mercado — preserve margem (use original_price quando existir como âncora), preços "premium" +10~25%, "competitivo" -5~15%, nunca zere e nunca crie preço negativo.
   - newImagePrompt: escreva em INGLÊS, estilo "editorial product photography", fotorrealista, 8k, sem texto/labels/watermark. Inclua o nome do produto e contexto coerente com o nicho.
4. Se o lojista pedir só UMA coisa (ex: só paleta), não invente mudanças em outros campos.
5. Jamais invente produtos que não estão no contexto. Use apenas os IDs listados.
6. Responda só o JSON, sem markdown, sem comentários.`;

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

      return json({
        planId: planRow.id,
        rationale: safePlan.rationale,
        tenantChanges: safePlan.tenantChanges,
        productChanges: safePlan.productChanges,
        status: "pending",
        message: "Plano pronto! Revise abaixo e toque em APLICAR quando aprovar.",
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

    return json({ error: "rota desconhecida", paths: ["plan", "plans", "apply", "rollback"] }, 404);
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
