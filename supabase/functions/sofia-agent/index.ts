// Sofia Agente de Loja — Função Individual Fragmentada
// Baseada no handler original do ai-chat-unified
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callAiJson, callAiStream } from "../_shared/ai-fallback.ts";
import { generateImageCascade } from "../_shared/image-gen.ts";
import { PLATFORM_KNOWLEDGE } from "../_shared/platform_knowledge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-route",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function requireTenantAdmin(admin: any, authHeader: string | null, tenantId: string) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("unauthorized");
  const token = authHeader.slice(7);
  const callerClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  if (error || !user) throw new Error("unauthorized");
  
  const userId = user.id;
  const { data: superRow } = await admin.from("platform_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  if (superRow) return userId;

  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId).eq("role", "admin").eq("approved", true).maybeSingle();
  if (!roleRow) throw new Error("forbidden_tenant");
  return userId;
}

async function buildStoreContext(admin: any, tenantId: string) {
  const { data: tenant, error: tErr } = await admin.from("tenants").select("*").eq("id", tenantId).single();
  if (tErr || !tenant) throw new Error("tenant_not_found");
  
  const { data: products, error: pErr } = await admin.from("products").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(120);
  if (pErr) throw pErr;

  const summary = [
    `Loja: ${tenant.name} (slug: ${tenant.slug}, nicho: ${tenant.niche || "não definido"})`,
    `Paleta atual: primary=${tenant.brand_primary_color || "?"} bg=${tenant.brand_bg_color || "?"} splash=${tenant.splash_bg_color || "?"}`,
    `Descrição atual: ${tenant.description || "(vazia)"}`,
    `Produtos (top 120):`,
    ...(products || []).slice(0, 80).map((p: any) => `- [${p.id}] "${p.name}" | R$${Number(p.price).toFixed(2)} | cat: ${p.category || "—"}/${p.subcategory || "—"} | ${p.in_stock ? "em estoque" : "esgotado"}`)
  ].join("\n");

  return { tenant, products: products || [], summary };
}

async function generateAndUploadImage(admin: any, prompt: string, tenantId: string, productName?: string) {
  try {
    const res = await generateImageCascade(admin, prompt, tenantId, "sofia", { productName });
    return { url: res?.url || null, err: res?.url ? null : "cascata de imagem falhou" };
  } catch (e: any) {
    return { url: null, err: e.message };
  }
}

async function applyPlan(admin: any, plan: any, tenantId: string, opts?: any) {
  const applied = [];
  const errors = [];
  const pc = (plan?.productChanges || []).filter((x: any) => x?.id);
  const onlyImages = Boolean(opts?.onlyImages);

  if (!onlyImages) {
    const tc = plan?.tenantChanges || {};
    const safeTc: any = {};
    const allowed = ["brand_primary_color", "brand_bg_color", "splash_bg_color", "description", "show_description", "show_title"];
    for (const k of Object.keys(tc)) {
      if (allowed.includes(k)) safeTc[k] = tc[k];
    }
    if (Object.keys(safeTc).length > 0) {
      const { error } = await admin.from("tenants").update(safeTc).eq("id", tenantId);
      if (error) errors.push(`tenants: ${error.message}`);
      else applied.push(`identidade (${Object.keys(safeTc).join(", ")})`);
    }
  }

  // Processa produtos em paralelo para as imagens
  const imageResults = await Promise.allSettled(pc.map(async (item: any) => {
    if (!item.newImagePrompt) return { id: item.id, url: null };
    return { id: item.id, ...(await generateAndUploadImage(admin, item.newImagePrompt, tenantId, item.productName)) };
  }));

  const imgMap = new Map();
  imageResults.forEach(r => {
    if (r.status === "fulfilled") imgMap.set(r.value.id, r.value);
  });

  for (const item of pc) {
    const img = imgMap.get(item.id);
    if (onlyImages) {
      if (!item.newImagePrompt) continue;
      if (img?.url) {
        const { error } = await admin.from("products").update({ image: img.url }).eq("id", item.id).eq("tenant_id", tenantId);
        if (error) errors.push(`foto ${item.id}: ${error.message}`);
        else applied.push(`foto ${item.id}`);
      } else {
        errors.push(`foto ${item.id}: ${img?.err || "falhou"}`);
      }
      continue;
    }

    const update: any = {};
    if (img?.url) update.image = img.url;
    if (item.newName) update.name = item.newName;
    if (item.newDescription != null) update.description = item.newDescription;
    if (typeof item.newPrice === "number") update.price = item.newPrice;

    if (Object.keys(update).length > 0) {
      const { error } = await admin.from("products").update(update).eq("id", item.id).eq("tenant_id", tenantId);
      if (error) errors.push(`produto ${item.id}: ${error.message}`);
      else applied.push(`produto ${item.id}`);
    }
    if (item.newImagePrompt && !img?.url) {
      errors.push(`foto ${item.id}: ${img?.err || "falhou (resto aplicado)"}`);
    }
  }

  return { applied, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop() || "";
    const body = await req.json().catch(() => ({}));

    // Chat Público (Widget Sofia)
    if (!path || path === "sofia-agent" || path === "chat") {
      const { messages, role = "visitor" } = body;
      const systemPrompt = `Sofia da SmartHubly. Curta, direta, amigável.
Foco: Criamos lojas com IA e WhatsApp.
Planos: Bronze, Prata, Ouro.
Regra: Máximo 2 parágrafos. Use emojis. Converta em cadastro/upgrade.
Papel do usuário: ${role}`;
      return await callAiStream(admin, { systemPrompt, messages, temperature: 0.7 });
    }

    const { tenantId } = body;
    const authHeader = req.headers.get("authorization");

    if (path === "plan" && req.method === "POST") {
      const { messages } = body;
      const userId = await requireTenantAdmin(admin, authHeader, tenantId);
      const ctx = await buildStoreContext(admin, tenantId);
      const lastMsg = [...messages].reverse().find(m => m.role === "user")?.content || "";

      // Roteamento de prospecção
      const prospectRe = /\b(ache|encontr|prospect|busc|liste|empresas|leads)\b/i;
      if (prospectRe.test(lastMsg)) {
        const route = await callAiJson(admin, {
          systemPrompt: "Extraia city, state, niche do pedido de prospecção. Responda JSON.",
          userPrompt: `PEDIDO: "${lastMsg}"`
        });
        if (route.city) {
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/prospect-google-search?apikey=${encodeURIComponent(anonKey)}`, {
            method: "POST",
            headers: { Authorization: authHeader || "", "Content-Type": "application/json" },
            body: JSON.stringify({ ...route, tenantId })
          });
          const pRes = await r.json().catch(()=>({}));
          return json({ status: "applied", message: `Achei ${pRes.leads?.length || 0} leads em ${route.city}.`, ...pRes });
        }
      }

      const SYSTEM = `Você é a SOFIA AGENTE. Analise a loja e sugira melhorias em JSON (rationale, tenantChanges, productChanges).\nContexto:\n${ctx.summary}`;
      const plan = await callAiJson(admin, { systemPrompt: SYSTEM, userPrompt: `PEDIDO: "${lastMsg}"` });
      
      const snapshotBefore = {
        tenant: { brand_primary_color: ctx.tenant.brand_primary_color, brand_bg_color: ctx.tenant.brand_bg_color, splash_bg_color: ctx.tenant.splash_bg_color, description: ctx.tenant.description },
        products: (plan.productChanges || []).map((p: any) => ctx.products.find((x: any) => x.id === p.id)).filter(Boolean)
      };

      const { data: planRow } = await admin.from("store_agent_plans").insert({
        tenant_id: tenantId, user_id: userId, user_request: lastMsg, plan, snapshot_before: snapshotBefore, status: "pending"
      }).select("id").single();

      return json({ planId: planRow.id, ...plan, status: "pending", message: "Plano pronto! Revise e clique em APLICAR." });
    }

    if (path === "apply" && req.method === "POST") {
      const { planId } = body;
      const { data: planRow } = await admin.from("store_agent_plans").select("*").eq("id", planId).single();
      const userId = await requireTenantAdmin(admin, authHeader, planRow.tenant_id);
      const result = await applyPlan(admin, planRow.plan, planRow.tenant_id);
      await admin.from("store_agent_plans").update({ status: "applied", applied_by: userId, applied_at: new Date().toISOString(), snapshot_after: result }).eq("id", planId);
      return json({ status: "applied", ...result });
    }

    if (path === "plans" && req.method === "POST") {
      await requireTenantAdmin(admin, authHeader, tenantId);
      const { data } = await admin.from("store_agent_plans").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20);
      return json({ plans: data });
    }

    if (path === "rollback" && req.method === "POST") {
      const { planId } = body;
      const { data: plan } = await admin.from("store_agent_plans").select("*").eq("id", planId).single();
      await requireTenantAdmin(admin, authHeader, plan.tenant_id);
      if (plan.snapshot_before?.tenant) await admin.from("tenants").update(plan.snapshot_before.tenant).eq("id", plan.tenant_id);
      for (const p of (plan.snapshot_before?.products || [])) {
        await admin.from("products").update({ name: p.name, price: p.price, description: p.description, image: p.image }).eq("id", p.id);
      }
      await admin.from("store_agent_plans").update({ status: "rolled_back" }).eq("id", planId);
      return json({ message: "Revertido!" });
    }

    return json({ error: "rota desconhecida" }, 404);
  } catch (e: any) {
    console.error("[sofia-agent] erro:", e);
    return json({ error: e.message }, 500);
  }
});
