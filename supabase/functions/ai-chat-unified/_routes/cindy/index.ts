// Cindy — copiloto IA do super admin com visão GLOBAL da plataforma.
// Verifica que o caller é super_admin antes de responder (acesso TOTAL aos dados).
// Multi-provider streaming: Google → Lovable → OpenRouter → Workers externos.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { CINDY_SYSTEM_PROMPT, OWNER_NAME } from "./_prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function isSuperAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;

  // Se o token for a publishable key, não é um token de usuário.
  // Mas a Cindy exige super_admin. No frontend, o super admin está logado.
  // Vamos validar o token JWT do usuário.
  const pubKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  if (token === pubKey) return false;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      pubKey!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return false;
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("platform_roles").select("role").eq("user_id", uid).eq("role", "super_admin").maybeSingle();
    return !!data;
  } catch (e) {
    console.error("Cindy auth check failed:", e);
    return false;
  }
}

// ============================================================
// CONTEXTO GLOBAL — Cindy vê tudo da plataforma
// ============================================================

// Cache do contexto da plataforma (TTL 30s) — economiza ~8s em chamadas repetidas
let _ctxCache: { at: number; text: string } | null = null;
const CTX_TTL_MS = 30_000;

async function fetchPlatformContext(supabase: any): Promise<string> {
  if (_ctxCache && Date.now() - _ctxCache.at < CTX_TTL_MS) return _ctxCache.text;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  // 🚀 TODAS as queries em paralelo — Cindy tem acesso TOTAL
  const [
    tenantsRes,
    openOrdersRes,
    ordersTodayRes,
    ordersMonthRes,
    invoicesRes,
    keysRes,
    workersRes,
    feeReqRes,
    recentOrdersRes,
    streetProsRes,
    remoteProsRes,
    platformRolesRes,
    userRolesRes,
    driversRes,
    suppliersRes,
    productsCountRes,
    automationRunsRes,
    automationSuggRes,
    financialEntriesRes,
    debtsRes,
    feeRequestsListRes,
    invoicesListRes,
    generatedWorkersRes,
    integrationsRes,
    platformSettingsRes,
    ghostFlagsRes,
    reviewsRes,
    openTicketsRes,
  ] = await Promise.all([
    supabase.from("tenants").select("id, name, slug, niche, billing_mode, monthly_fee, platform_fee_percent, mercadopago_token, created_at, store_mode, suspended"),
    supabase.from("orders").select("*", { count: "exact", head: true }).in("status", ["received", "preparing", "out-for-delivery", "ready-for-pickup", "pending_payment"]),
    supabase.from("orders").select("total, status, tenant_id, platform_fee").gte("created_at", today.toISOString()),
    supabase.from("orders").select("total, status, platform_fee, tenant_id").gte("created_at", monthStart.toISOString()),
    supabase.from("billing_invoices").select("status, amount, due_date, tenant_id"),
    supabase.from("api_keys").select("is_exhausted").eq("provider", "google_ai"),
    supabase.from("ai_workers").select("worker_type, is_active, is_exhausted").eq("is_active", true),
    supabase.from("fee_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("orders").select("tenant_id").gte("created_at", weekAgo.toISOString()),
    supabase.from("street_prospects").select("id, store_name, street_name, status, tags, reminder_at, notes, created_at").order("updated_at", { ascending: false }),
    supabase.from("remote_prospects").select("id, name, status, created_at"),
    supabase.from("platform_roles").select("user_id, role"),
    supabase.from("user_roles").select("role, approved, tenant_id"),
    supabase.from("drivers").select("id, tenant_id, is_online"),
    supabase.from("suppliers").select("id, tenant_id"),
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("automation_runs").select("automation_type, status").gte("created_at", weekAgo.toISOString()),
    supabase.from("automation_suggestions").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("financial_entries").select("type, amount").gte("date", monthStart.toISOString()),
    supabase.from("debts").select("amount, paid"),
    supabase.from("fee_requests").select("tenant_id, requested_percent, status, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(10),
    supabase.from("billing_invoices").select("tenant_id, amount, due_date, status").in("status", ["pending", "payment_declared"]).order("due_date", { ascending: true }).limit(15),
    supabase.from("generated_workers").select("id, status, created_at"),
    supabase.from("integration_settings").select("tenant_id, provider, active"),
    supabase.from("platform_settings").select("key"),
    supabase.from("ghost_order_flags").select("*", { count: "exact", head: true }),
    supabase.from("order_reviews").select("rating").gte("created_at", monthStart.toISOString()),
    supabase.from("support_tickets").select("id, subject, description, status, priority, tenant_id, created_at").in("status", ["open", "pending", "waiting"]).order("created_at", { ascending: false }).limit(25),
  ]);

  const tenants = tenantsRes.data;
  const totalTenants = tenants?.length || 0;
  const activeTenants = (tenants || []).filter((t: any) => t.mercadopago_token).length;
  const suspendedTenants = (tenants || []).filter((t: any) => t.suspended).length;
  const newTenantsThisWeek = (tenants || []).filter((t: any) => new Date(t.created_at) >= weekAgo).length;
  const perOrderTenants = (tenants || []).filter((t: any) => t.billing_mode === "per_order").length;
  const monthlyTenants = (tenants || []).filter((t: any) => t.billing_mode === "monthly_fixed").length;

  const openOrdersCount = openOrdersRes.count;
  const ordersToday = ordersTodayRes.data;
  const ordersTodayCount = ordersToday?.length || 0;
  const revenueToday = (ordersToday || []).filter((o: any) => o.status === "delivered").reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const platformRevenueToday = (ordersToday || []).filter((o: any) => o.status === "delivered").reduce((s: number, o: any) => s + Number(o.platform_fee || 0), 0);

  const ordersMonth = ordersMonthRes.data;
  const revenueMonth = (ordersMonth || []).filter((o: any) => o.status === "delivered").reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const platformRevenueMonth = (ordersMonth || []).filter((o: any) => o.status === "delivered").reduce((s: number, o: any) => s + Number(o.platform_fee || 0), 0);

  const gmvByTenant = new Map<string, number>();
  (ordersMonth || []).forEach((o: any) => {
    if (o.status !== "delivered") return;
    gmvByTenant.set(o.tenant_id, (gmvByTenant.get(o.tenant_id) || 0) + Number(o.total || 0));
  });
  const tenantNameById = new Map((tenants || []).map((t: any) => [t.id, t.name]));
  const topTenants = [...gmvByTenant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, v], i) => `${i + 1}. ${tenantNameById.get(id) || "—"} R$${v.toFixed(2)}`);

  const invoices = invoicesRes.data;
  const invPending = (invoices || []).filter((i: any) => i.status === "pending").length;
  const invDeclared = (invoices || []).filter((i: any) => i.status === "payment_declared").length;
  const invOverdue = (invoices || []).filter((i: any) => i.status === "pending" && new Date(i.due_date) < new Date()).length;
  const totalDue = (invoices || []).filter((i: any) => i.status === "pending").reduce((s: number, i: any) => s + Number(i.amount || 0), 0);

  const keys = keysRes.data;
  const gOk = (keys || []).filter((k: any) => !k.is_exhausted).length;
  const gExh = (keys || []).filter((k: any) => k.is_exhausted).length;
  const ws = workersRes.data;
  const wstats = { chat: { ok: 0, exh: 0 }, image: { ok: 0, exh: 0 }, txt: { ok: 0, exh: 0 } } as any;
  (ws || []).forEach((w: any) => {
    const t = (w.worker_type || "chat") as "chat" | "image" | "txt";
    if (!wstats[t]) return;
    if (w.is_exhausted) wstats[t].exh++; else wstats[t].ok++;
  });

  const feeReqPending = feeReqRes.count;
  const recentOrders = recentOrdersRes.data;
  const activeIds = new Set((recentOrders || []).map((o: any) => o.tenant_id));
  const stalledTenants = (tenants || []).filter((t: any) => !activeIds.has(t.id) && new Date(t.created_at) < weekAgo);

  // Prospecção
  const streetPros = streetProsRes.data || [];
  const remotePros = remoteProsRes.data || [];
  const streetByStatus = new Map<string, number>();
  streetPros.forEach((p: any) => streetByStatus.set(p.status || "—", (streetByStatus.get(p.status || "—") || 0) + 1));
  const remoteByStatus = new Map<string, number>();
  remotePros.forEach((p: any) => remoteByStatus.set(p.status || "—", (remoteByStatus.get(p.status || "—") || 0) + 1));

  // Usuários
  const platformRoles = platformRolesRes.data || [];
  const superAdmins = platformRoles.filter((r: any) => r.role === "super_admin").length;
  const userRoles = userRolesRes.data || [];
  const tenantAdmins = userRoles.filter((r: any) => r.role === "admin" && r.approved).length;
  const pendingAdmins = userRoles.filter((r: any) => r.role === "admin" && !r.approved).length;

  // Operação
  const drivers = driversRes.data || [];
  const driversOnline = drivers.filter((d: any) => d.is_online).length;
  const suppliers = suppliersRes.data || [];
  const totalProducts = productsCountRes.count || 0;

  // Financeiro agregado
  const financialEntries = financialEntriesRes.data || [];
  const incomeMonth = financialEntries.filter((e: any) => e.type === "income").reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const expenseMonth = financialEntries.filter((e: any) => e.type === "expense").reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const debts = debtsRes.data || [];
  const openDebts = debts.filter((d: any) => !d.paid).reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  // Automações
  const autoRuns = automationRunsRes.data || [];
  const autoOk = autoRuns.filter((r: any) => r.status === "success" || r.status === "ok").length;
  const autoFail = autoRuns.filter((r: any) => r.status === "error" || r.status === "failed").length;
  const autoPendingSugg = automationSuggRes.count || 0;

  // Nichos
  const nicheCount = new Map<string, number>();
  (tenants || []).forEach((t: any) => {
    const k = t.niche || "—";
    nicheCount.set(k, (nicheCount.get(k) || 0) + 1);
  });
  const topNiches = [...nicheCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([n, c]) => `${n}:${c}`).join(", ");

  // Listagens detalhadas
  const feeReqList = (feeRequestsListRes.data || []).map((f: any) =>
    `· ${tenantNameById.get(f.tenant_id) || "—"} → ${f.requested_percent}% (${new Date(f.created_at).toLocaleDateString("pt-BR")})`);
  const invList = (invoicesListRes.data || []).map((i: any) =>
    `· ${tenantNameById.get(i.tenant_id) || "—"} R$${Number(i.amount).toFixed(2)} venc ${new Date(i.due_date).toLocaleDateString("pt-BR")} [${i.status}]`);

  const generatedWorkers = generatedWorkersRes.data || [];
  const gwActive = generatedWorkers.filter((w: any) => w.status === "active").length;
  const gwTotal = generatedWorkers.length;

  const integrations = integrationsRes.data || [];
  const intByProvider = new Map<string, number>();
  integrations.filter((i: any) => i.active).forEach((i: any) =>
    intByProvider.set(i.provider, (intByProvider.get(i.provider) || 0) + 1));
  const intSummary = [...intByProvider.entries()].map(([p, c]) => `${p}:${c}`).join(", ") || "—";

  const settingsKeys = (platformSettingsRes.data || []).map((s: any) => s.key).join(", ") || "—";

  const reviews = reviewsRes.data || [];
  const avgRating = reviews.length ? (reviews.reduce((s: number, r: any) => s + Number(r.rating || 0), 0) / reviews.length).toFixed(2) : "—";

  const ghostFlagsCount = ghostFlagsRes.count || 0;

  const text = [
    "## VISÃO GERAL DA PLATAFORMA AGORA",
    `- Lojas: **${totalTenants}** total | ${activeTenants} com Mercado Pago | ${suspendedTenants} suspensas | ${newTenantsThisWeek} novas em 7d`,
    `- IDs das lojas (pra gerar post por loja): ${(tenants || []).map((t: any) => `${t.name}=${t.id.slice(0, 8)}`).join(" | ") || "—"}`,
    `- Modelo de cobrança: ${perOrderTenants} por pedido (%), ${monthlyTenants} mensalidade fixa`,
    `- Nichos: ${topNiches || "—"}`,
    `- Produtos cadastrados na plataforma toda: ${totalProducts}`,
    `- Pedidos abertos agora: **${openOrdersCount ?? 0}**`,
    `- Hoje: ${ordersTodayCount} pedidos | GMV entregue R$${revenueToday.toFixed(2)} | receita plataforma R$${platformRevenueToday.toFixed(2)}`,
    `- Mês: GMV R$${revenueMonth.toFixed(2)} | receita plataforma R$${platformRevenueMonth.toFixed(2)}`,
    `- Top 5 lojas do mês: ${topTenants.length ? topTenants.join(" · ") : "(sem entregas)"}`,
    `- Avaliação média (mês): ${avgRating}`,
    "",
    "## COBRANÇAS (aba Cobranças)",
    `- Pendentes: ${invPending} (R$${totalDue.toFixed(2)}) | Declaradas aguardando: ${invDeclared} | ⚠️ Vencidas: ${invOverdue}`,
    invList.length ? `Próximas/abertas:\n${invList.join("\n")}` : "",
    "",
    "## TAXAS (aba Taxas)",
    `- Pedidos de redução pendentes: ${feeReqPending ?? 0}`,
    feeReqList.length ? feeReqList.join("\n") : "",
    "",
    "## SAÚDE OPERACIONAL (aba Saúde Lojas)",
    `- Lojas paradas (sem pedido 7d): **${stalledTenants.length}**${stalledTenants.length ? " — ex: " + stalledTenants.slice(0, 5).map((t: any) => t.name).join(", ") : ""}`,
    `- Pedidos fantasmas flagados: ${ghostFlagsCount}`,
    `- Automações 7d: ${autoOk} ok / ${autoFail} falhas | Sugestões pendentes: ${autoPendingSugg}`,
    `- Motoboys: ${drivers.length} cadastrados (${driversOnline} online) | Fornecedores: ${suppliers.length}`,
    "",
    "## FINANCEIRO PLATAFORMA (aba Financeiro)",
    `- Mês: Receita R$${incomeMonth.toFixed(2)} | Despesa R$${expenseMonth.toFixed(2)} | Líquido R$${(incomeMonth - expenseMonth).toFixed(2)}`,
    `- Dívidas em aberto: R$${openDebts.toFixed(2)}`,
    "",
    "## USUÁRIOS (aba Usuários)",
    `- Super admins: ${superAdmins} | Admins lojas aprovados: ${tenantAdmins} | Aguardando aprovação: ${pendingAdmins}`,
    "",
    "## PROSPECÇÃO (abas Prospecção / Prospecção Remota)",
    `- Rua: ${streetPros.length} total | ${[...streetByStatus.entries()].map(([s, c]) => `${s}:${c}`).join(", ") || "—"}`,
    `- Remota (IA): ${remotePros.length} total | ${[...remoteByStatus.entries()].map(([s, c]) => `${s}:${c}`).join(", ") || "—"}`,
    (() => {
      const tagged = streetPros.filter((p: any) => Array.isArray(p.tags) && p.tags.length > 0).slice(0, 25);
      if (!tagged.length) return "";
      const lines = tagged.map((p: any) => {
        const tagLabels = (p.tags || []).map((t: any) => {
          const label = String(t?.label ?? "").trim();
          const kind = t?.kind === "manual" ? "👤" : "🤖";
          return label ? `${kind}${label}` : "";
        }).filter(Boolean).join(" | ");
        const rem = p.reminder_at ? ` ⏰${new Date(p.reminder_at).toLocaleString("pt-BR")}` : "";
        const notes = p.notes ? ` — ${String(p.notes).slice(0, 80)}` : "";
        return `· ${p.store_name || "—"} [${p.status || "—"}] ${tagLabels}${rem}${notes}`;
      });
      return `Leads com TAGS (rua):\n${lines.join("\n")}`;
    })(),
    "",
    "## INFRA DE IA (abas API Keys, Workers IA)",
    `- Chaves Google AI: ${gOk} ativas / ${gExh} esgotadas`,
    `- Workers chat: ${wstats.chat.ok}/${wstats.chat.exh} | imagem: ${wstats.image.ok}/${wstats.image.exh} | parse: ${wstats.txt.ok}/${wstats.txt.exh}`,
    `- Workers gerados (auto): ${gwActive}/${gwTotal} ativos`,
    `- Fallback: Google → Lovable → OpenRouter → Workers`,
    "",
    "## INTEGRAÇÕES ATIVAS NAS LOJAS",
    `- Por provider: ${intSummary}`,
    "",
    "## CONFIGURAÇÕES (platform_settings)",
    `- Keys salvas: ${settingsKeys}`,
    "",
    "## CHAMADOS ABERTOS (aba Suporte) — use os ids pra RESPONDER chamados",
    (openTicketsRes.data?.length || 0) > 0
      ? (openTicketsRes.data || []).map((t: any) =>
          `· id ${t.id.slice(0, 8)} | "${t.subject}" [${t.status}] criado ${new Date(t.created_at).toLocaleString("pt-BR")}`).join("\n")
      : "(nenhum chamado aberto)",
  ].filter(Boolean).join("\n");
  _ctxCache = { at: Date.now(), text };
  return text;
}

// ============================================================
// PROVIDERS DE STREAMING (mesma lógica da Sofia)
// ============================================================

async function getGoogleKeys(supabase: any) {
  const { data } = await supabase.from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  return (data || []) as ApiKeyEntry[];
}
async function getAllWorkers(supabase: any) {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...(active || []), ...(exhausted || [])] as AiWorker[];
}

function streamGeminiResponse(response: Response): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
          } catch {}
        }
      }
      try { await writer.write(encoder.encode("data: [DONE]\n\n")); } catch {}
    } catch (e) { console.error("Cindy stream err:", e); }
    finally { try { await writer.close(); } catch {} }
  })();
  return new Response(readable, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

async function tryGoogleStream(messages: any[], systemPrompt: string, keys: ApiKeyEntry[], supabase: any): Promise<Response | null> {
  const allKeys = keys.length > 0 ? keys
    : Deno.env.get("GOOGLE_AI_API_KEY") ? [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }] : [];
  const geminiMessages = messages.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const payload = {
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    contents: geminiMessages,
    generationConfig: { temperature: 0.4, maxOutputTokens: 2000, topP: 0.9 },
  };
  // Contas Google AI novas não têm acesso aos modelos legados (404 "no longer available").
  // Nesses casos, repetir a tentativa com modelos modernos disponíveis para contas novas.
  const STREAM_MODELS = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
  for (const keyEntry of allKeys) {
    for (const modelName of STREAM_MODELS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${keyEntry.api_key}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        );
        const bodyText = await response.text();
        const isModelUnavailable = response.status === 404 && /no longer available|not found for API/i.test(bodyText);
        if (isModelUnavailable) continue; // tentar próximo modelo com a mesma chave
        if (response.status === 429 || response.status === 403) {
          if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
          break; // chave esgotada, pular para a próxima chave
        }
        if (!response.ok) continue;
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
        // re-emite o SSE já lido + o restante da resposta como stream (compatível com o parser do front)
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        (async () => {
          try {
            await writer.write(encoder.encode(bodyText));
            const remaining = await response.text();
            await writer.write(encoder.encode(remaining));
            await writer.write(encoder.encode("data: [DONE]\n\n"));
            await writer.close();
          } catch { try { await writer.close(); } catch {} }
        })();
        return new Response(readable, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
      } catch (e) { console.error(`Cindy Google failed (${modelName}):`, e); continue; }
    }
  }
  return null;
}

async function tryLovableStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true, temperature: 0.4, max_tokens: 2000 }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

async function tryOpenRouterStream(messages: any[], systemPrompt: string): Promise<Response | null> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true }),
    });
    if (response.status === 429 || response.status === 402) return null;
    if (!response.ok) return null;
    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch { return null; }
}

async function tryWorkerStream(messages: any[], systemPrompt: string, workers: AiWorker[], supabase: any): Promise<Response | null> {
  const PARALLEL = 3;
  const TIMEOUT_MS = 6000;

  const attemptOne = async (worker: AiWorker, signal: AbortSignal): Promise<{ worker: AiWorker; response: Response } | null> => {
    const url = worker.base_url.includes('/functions/') ? worker.base_url : `${worker.base_url}/functions/v1/ai-chat`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, systemPrompt, tenantName: "Cindy", niche: "super_admin" }),
        signal,
      });
      if (response.status === 429 || response.status === 402 || response.status === 503) {
        if (!worker.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id);
        try { response.body?.cancel(); } catch {}
        return null;
      }
      if (!response.ok) { try { response.body?.cancel(); } catch {} return null; }
      return { worker, response };
    } catch {
      if (!worker.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", worker.id).then(() => {}, () => {});
      }
      return null;
    }
  };

  for (let i = 0; i < workers.length; i += PARALLEL) {
    const batch = workers.slice(i, i + PARALLEL);
    const ctrls = batch.map(() => new AbortController());
    const timers = ctrls.map((c) => setTimeout(() => c.abort(), TIMEOUT_MS));
    const promises = batch.map((w, idx) => attemptOne(w, ctrls[idx].signal).then((r) => r ?? Promise.reject(new Error("nope"))));
    let winnerIdx = -1;
    let winner: { worker: AiWorker; response: Response } | null = null;
    try {
      winner = await Promise.any(promises);
      winnerIdx = batch.findIndex((b) => b.id === winner!.worker.id);
    } catch { winner = null; }
    timers.forEach(clearTimeout);
    if (winner) {
      ctrls.forEach((c, idx) => { if (idx !== winnerIdx) c.abort(); });
      const w = winner.worker;
      if (w.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", w.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
      }
      return new Response(winner.response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }
  }
  return null;
}

// ============================================================
// HANDLER
// ============================================================

export async function cindy(req: Request, body?: unknown): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
    
    // Verifica que é super_admin (acesso TOTAL aos dados)
    const ok = await isSuperAdmin(req.headers.get("Authorization"));
    if (!ok) {
      return new Response(JSON.stringify({ error: "Acesso restrito ao super admin." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages } = parsed;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();
    let platformCtx = "(sem dados ao vivo agora)";
    try { platformCtx = await fetchPlatformContext(supabase); }
    catch (e) { console.error("Cindy platform ctx failed:", e); }

    // Carrega instruções customizadas do super admin (se houver)
    let customInstructions = "(nenhum ajuste personalizado — siga o comportamento padrão acima)";
    try {
      const { data: setting } = await supabase
        .from("platform_settings").select("value").eq("key", "cindy_custom_prompt").maybeSingle();
      const txt = (setting?.value as any)?.text;
      if (typeof txt === "string" && txt.trim().length > 0) {
        customInstructions = txt.trim();
      }
    } catch (e) { console.error("Cindy custom prompt load failed:", e); }

    const systemPrompt = CINDY_SYSTEM_PROMPT
      .replace("{{PLATFORM_CONTEXT}}", platformCtx)
      .replace("{{CUSTOM_INSTRUCTIONS}}", customInstructions);
    console.log("[cindy] super_admin chat iniciado");

    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    // 🚀 Race Google vs Lovable em paralelo — quem chegar primeiro ganha
    const wrap = (p: Promise<Response | null>) => p.then((r) => r ?? Promise.reject(new Error("nope")));
    try {
      const winner = await Promise.any([
        wrap(tryGoogleStream(messages, systemPrompt, keys, supabase)),
        wrap(tryLovableStream(messages, systemPrompt)),
      ]);
      return winner;
    } catch { /* ambos falharam, segue para fallback */ }
    const r3 = await tryOpenRouterStream(messages, systemPrompt);
    if (r3) return r3;
    const r4 = await tryWorkerStream(messages, systemPrompt, workers, supabase);
    if (r4) return r4;

    return new Response(JSON.stringify({ error: "Tô sem IA disponível agora amor 😅 — tenta de novo em uns segundos ou cadastra mais workers." }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[unified:cindy] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}
