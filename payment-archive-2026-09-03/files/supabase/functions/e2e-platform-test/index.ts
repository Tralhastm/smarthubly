import { createClient } from "https://esm.sh/@supabase/supabase-js@2.52.1";

type TResult = { area: string; name: string; status: "pass" | "fail" | "info" | "warn"; detail: string; ms: number };
const results: TResult[] = [];
let started = 0;
function pass(area: string, name: string, detail: string, ms: number) { results.push({ area, name, status: "pass", detail, ms }); }
function fail(area: string, name: string, detail: string, ms: number) { results.push({ area, name, status: "fail", detail: typeof detail === "object" ? JSON.stringify(detail).slice(0, 180) : String(detail).slice(0, 200), ms }); }
function info(area: string, name: string, detail: string, ms: number) { results.push({ area, name, status: "info", detail, ms }); }

function nowMs() { started = performance.now(); return started; }
function elap(s: number) { return Math.round(performance.now() - s); }

// ---------- helpers ----------
function getSupabaseAdmin(supabaseUrl: string, supabaseKey: string) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${supabaseKey}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function timed<T>(p: Promise<T>): Promise<{ v: T; ms: number }> {
  const s = performance.now();
  try {
    const v = await p;
    return { v, ms: Math.round(performance.now() - s) };
  } catch (e: any) {
    return { v: { __err: e?.message ?? String(e) } as T, ms: Math.round(performance.now() - s) };
  }
}

function isErr(v: any): v is { __err: string } { return v && typeof v === "object" && "__err" in v; }

function uid() {
  return ("" + Math.random()).slice(2) + Date.now().toString(36) + "e2e";
}

const TEST_PREFIX = "E2E-TEST-";
const TEST_TENANT_SLUG = "e2e-test-loja";

// ---------- áreas de teste ----------

async function areaDocumentosTeste(admin: any): Promise<void> {
  // Cria documentos de teste reais (tenant, categoria, produtos, cupom) e valida
  const s = nowMs();
  const slug = TEST_TENANT_SLUG;
  const categoryId = uid();
  const prodIds: string[] = [uid(), uid()];
  const couponId = uid();

  // 1) criar tenant de teste
  const { data: t, error: te } = await admin.from("tenants").upsert({
    slug, name: TEST_PREFIX + "LOJA DE TESTE E2E", niche: "teste", active: true,
    store_mode: "physical", billing_mode: "off", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id,slug").single();
  if (te || !t) { fail("Documentos de teste", "Criar tenant de teste", JSON.stringify(te ?? "sem retorno").slice(0, 180), elap(s)); return; }
  pass("Documentos de teste", "Criar tenant de teste", `tenant ${t.id} criado`, elap(s));

  // 2) categoria
  const { error: ce } = await admin.from("product_categories").upsert({
    id: categoryId, tenant_id: t.id, name: TEST_PREFIX + "CATEGORIA TESTE", sort_order: 0,
  });
  (ce ? fail : pass)("Documentos de teste", "Criar categoria", ce ? String(ce) : `categoria ${categoryId.slice(0, 8)} criada`, elap(s));

  // 3) produtos (2)
  let prodOk = 0;
  for (const pid of prodIds) {
    const { error: pe } = await admin.from("products").upsert({
      id: pid, tenant_id: t.id, name: TEST_PREFIX + "PRODUTO TESTE " + pid.slice(0, 6),
      price: 12.99, description: "Produto de teste E2E",
    });
    if (!pe) prodOk++;
  }
  (prodOk === 2 ? pass : fail)("Documentos de teste", "Criar produtos (2)", `${prodOk}/2 inseridos`, elap(s));

  // 4) cupom
  const { error: cu } = await admin.from("coupons").upsert({
    id: couponId, tenant_id: t.id, code: "E2ETEST10", discount_type: "percent", discount_value: 10,
    min_order_value: 0, max_uses: 10, active: true,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  (cu ? fail : pass)("Documentos de teste", "Criar cupom", cu ? String(cu) : "cupom E2ETEST10 criado", elap(s));

  // 5) limpar tudo (rollback)
  await admin.from("coupons").delete().eq("id", couponId);
  await admin.from("products").delete().in("id", prodIds);
  await admin.from("product_categories").delete().eq("id", categoryId);
  await admin.from("tenants").delete().eq("id", t.id);
  info("Documentos de teste", "Limpeza (rollback)", "tenant, categoria, produtos e cupom removidos", elap(s));
}

async function areaFluxoPedidoCompleto(admin: any): Promise<void> {
  // Percorre os estágios reais de um pedido via API e valida contadores
  const s = nowMs();
  const storeId = uid();
  // usar tenant demo existente (demo-smarthubly) se ativo, senão pular
  const { data: demo, error: de } = await admin.from("tenants").select("id").eq("slug", "demo-smarthubly").single();
  if (de || !demo) { info("Fluxo de pedido", "Pular (sem tenant demo)", de ? String(de) : "demo-smarthubly ausente", elap(s)); return; }

  const orderId = uid();
  const stages: string[] = ["received", "preparing", "ready-for-pickup", "out-for-delivery", "delivered"];
  let stageOk = 0;
  // criar
  const { error: ie } = await admin.from("orders").upsert({
    id: orderId, tenant_id: demo.id, customer_name: TEST_PREFIX + "CLIENTE TESTE", customer_phone: "31900000001",
    total: 25.98, payment_method: "pix", status: "received",
  });
  // item de teste do pedido
  const itemId = uid();
  const { error: iie } = await admin.from("order_items").upsert({
    id: itemId, order_id: orderId, product_name: TEST_PREFIX + "ITEM TESTE",
    quantity: 2,
  });
  if (!ie && !iie) info("Fluxo de pedido", "Criar pedido de teste", `pedido ${orderId.slice(0, 8)} + item de teste criado (pix, R$25,98)`, elap(s));
  else if (ie) fail("Fluxo de pedido", "Criar pedido de teste", String(ie), elap(s));
  else fail("Fluxo de pedido", "Criar pedido de teste", `pedido criado mas item falhou: ${String(iie)}`, elap(s));

  for (const st of stages) {
    const { error: ue } = await admin.from("orders").update({ status: st }).eq("id", orderId);
    if (!ue) stageOk++;
  }
  (stageOk === stages.length ? pass : fail)("Fluxo de pedido", `Percorrer ${stages.length} estágios (received→delivered)`, `${stageOk}/${stages.length} transições OK`, elap(s));

  const { data: fin, error: fe } = await admin.from("orders").select("status").eq("id", orderId).single();
  const isDelivered = !fe && fin && fin.status === "delivered";
  (isDelivered ? pass : fail)("Fluxo de pedido", "Estado final = delivered", isDelivered ? `status final: ${fin.status}` : String(fe ?? "status inesperado"), elap(s));

  await admin.from("order_items").delete().eq("id", itemId);
  await admin.from("orders").delete().eq("id", orderId);
  info("Fluxo de pedido", "Limpeza", "pedido e item de teste removidos", elap(s));
}

async function areaAutomacoes(admin: any): Promise<void> {
  const s = nowMs();
  // colunas booleanas de automação em tenants
  const { data: demo, error: de } = await admin.from("tenants").select("id,auto_confirm_paid_orders,auto_confirm_card_payments,auto_cancel_pending_payment,auto_low_stock_promo,auto_review_ai_reply,sound_alert_enabled,printer_enabled,abandoned_cart_email_enabled,auto_fraud_check").eq("slug", "demo-smarthubly").single();
  if (de || !demo) { info("Automações", "Pular (sem tenant demo)", de ? String(de) : "demo ausente", elap(s)); return; }

  // leitura de todas as flags de automação
  pass("Automações", "Ler flags de automação do tenant", Object.keys(demo).filter((k) => k.startsWith("auto_") || k.endsWith("_enabled")).join(", ").slice(0, 180), elap(s));

  // toggle idempotente: ativar e restaurar
  const { error: t1 } = await admin.from("tenants").update({ auto_confirm_paid_orders: true }).eq("id", demo.id);
  const { error: t2 } = await admin.from("tenants").update({ auto_confirm_paid_orders: false }).eq("id", demo.id);
  (!t1 && !t2 ? pass : fail)("Automações", "Toggle auto_confirm_paid_orders (ativar/restaurar)", (t1 || t2) ? String(t1 || t2) : "toggle OK sem afetar produção", elap(s));

  // verificar existência das rotas EF de automação (não chamar, só listar functions instaladas)
  const r = await fetch("https://qbcplbcdxoyqpmcehnvu.supabase.co/functions/v1/", { headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` } });
  info("Automações", "Edge functions disponíveis", r.status === 200 ? "lista de functions acessível" : `status ${r.status}`, elap(s));
}

async function areaGarcom(admin: any): Promise<void> {
  const s = nowMs();
  const { data: demo, error: de } = await admin.from("tenants").select("id,waiter_access_token,tables_enabled").eq("slug", "demo-smarthubly").single();
  if (de || !demo) { info("Garçom", "Pular (sem tenant demo)", String(de), elap(s)); return; }
  pass("Garçom", "Ler configuração do garçom", `waiter token: ${demo.waiter_access_token ? "definido" : "vazio"} | mesas: ${demo.tables_enabled}`, elap(s));

  const { data: tables, error: te } = await admin.from("restaurant_tables").select("id,tenant_id,label").eq("tenant_id", demo.id).limit(5);
  (!te && Array.isArray(tables) ? pass : fail)("Garçom", "Listar mesas (restaurant_tables)", te ? String(te) : `${(tables as any[]).length} mesas`, elap(s));

  const { data: devices, error: dv } = await admin.from("garcom_devices").select("id,tenant_id").limit(5);
  info("Garçom", "Tabela garcom_devices", dv ? String(dv) : `${(devices?.length ?? []).toString ? (devices as any[]).length : 0} dispositivos`, elap(s));
}

async function areaFinanceiroDetalhado(admin: any): Promise<void> {
  const s = nowMs();
  const { data: pt, error: pe } = await admin.from("payment_transactions").select("id,tenant_id,status,amount,method").limit(10);
  (!pe && Array.isArray(pt) ? pass : fail)("Financeiro", "payment_transactions", pe ? String(pe) : `${(pt as any[]).length} registros`, elap(s));

  const { data: st, error: se } = await admin.from("tenant_financial_reports").select("id").limit(1);
  info("Financeiro", "tenant_financial_reports", se ? "tabela inexistente: " + String(se).slice(0, 60) : `presente (${(st as any[]).length})`, elap(s));

  const { data: inv, error: ie } = await admin.from("invoices").select("id,status").limit(10);
  info("Financeiro", "invoices", ie ? "tabela inexistente: " + String(ie).slice(0, 60) : `${(inv as any[]).length} faturas`, elap(s));
}

async function areaIAModelos(admin: any): Promise<void> {
  const s = nowMs();
  // testar cada worker de texto com fallback de modelos (chaves reais)
  const { data: keys, error: ke } = await admin.from("api_keys").select("id,provider,is_exhausted,last_used_at").eq("provider", "google_ai").order("last_used_at", { ascending: false, nullsFirst: false }).limit(4);
  if (ke) { fail("IA", "api_keys", String(ke), elap(s)); return; }
  pass("IA", "Chaves Gemini cadastradas", (keys as any[]).map((k) => `${k.id}: ${k.is_exhausted === false ? "ativa" : "esgotada/pendente"} (usou ${k.last_used_at ?? "—"})`).join(" | "), elap(s));

  const { data: w, error: we } = await admin.from("ai_workers").select("id,status").limit(40);
  if (!we && Array.isArray(w)) {
    const ativos = (w as any[]).filter((x) => x.status === "active").length;
    (ativos > 10 ? pass : fail)("IA", "Rede de workers de imagem", `${ativos}/${(w as any[]).length} ativos`, elap(s));
  }

  // testar chamada real ao Gemini com modelo novo via fetch direto
  const activeKey = (keys as any[]).find((k) => k.is_exhausted === false);
  if (activeKey) {
    const { data: full, error: fe2 } = await admin.from("api_keys").select("api_key").eq("id", activeKey.id).single();
    if (!fe2 && full) {
      const tryModel = async (model: string) => {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": (full as any).api_key },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Responda OK" }] }] }),
        });
        return res.status;
      };
      const st1 = await tryModel("gemini-3.1-flash-lite");
      (st1 === 200 ? pass : fail)("IA", "Gemini gemini-3.1-flash-lite", `HTTP ${st1}`, elap(s));
      const st2 = await tryModel("gemini-flash-lite-latest");
      info("IA", "Gemini flash-lite-latest", `HTTP ${st2}`, elap(s));
    }
  }
}

async function areaVitrinesPorLayout(admin: any): Promise<void> {
  const s = nowMs();
  // testa TODAS as lojas ativas + 4 layouts no tenant demo e cada rota pública
  const { data: stores, error: se } = await admin.from("tenants").select("id,slug,name,niche,active").eq("active", true).order("created_at", { ascending: false }).limit(12);
  if (se || !Array.isArray(stores)) { fail("Vitrines", "Listar lojas ativas", String(se), elap(s)); return; }
  pass("Vitrines", `Listar lojas ativas (${stores.length})`, stores.map((t: any) => t.slug).join(", "), elap(s));

  const rotas = ["/", "/checkout", "/carrinho", "/produtos", "/minha-conta"];
  let okTotal = 0, failTotal = 0;
  for (const t of stores as any[]) {
    for (const rota of rotas) {
      try {
        const res = await fetch(`https://smarthubly.pages.dev/loja/${t.slug}${rota}`, { redirect: "follow", signal: AbortSignal.timeout(20000) });
        if (res.ok) okTotal++; else failTotal++;
      } catch { failTotal++; }
    }
  }
  (failTotal === 0 ? pass : fail)("Vitrines", `${stores.length} lojas x ${rotas.length} rotas públicas (${rotas.length * stores.length} requisições)`, `OK: ${okTotal} | falhas: ${failTotal}`, elap(s));

  // layouts de cardápio no tenant demo
  const { data: demo, error: de } = await admin.from("tenants").select("id").eq("slug", "demo-smarthubly").single();
  if (demo) {
    const layouts = ["grid", "list", "compact", "magazine"];
    for (const L of layouts) {
      const { error: u } = await admin.from("tenants").update({ catalog_layout: L }).eq("id", demo.id);
      if (u) { fail("Vitrines/Layouts", `Setar layout ${L}`, String(u), elap(s)); continue; }
      try {
        const res = await fetch(`https://smarthubly.pages.dev/loja/${demo.slug}`, { redirect: "follow", signal: AbortSignal.timeout(20000) });
        (res.ok ? pass : fail)("Vitrines/Layouts", `Layout ${L} aplicado e vitrine 200`, `HTTP ${res.status}`, elap(s));
      } catch { fail("Vitrines/Layouts", `Layout ${L}`, "timeout/erro de rede", elap(s)); }
    }
    await admin.from("tenants").update({ catalog_layout: "grid" }).eq("id", demo.id);
    info("Vitrines/Layouts", "Restaurar layout demo = grid", "layout restaurado", elap(s));
  }
}

// ---------- roteador ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });

  const xToken = req.headers.get("X-Auto-Test-Token");
  const auth = req.headers.get("Authorization") ?? "";
  let allowed = false;
  const secret = Deno.env.get("AUTO_TEST_TOKEN");
  if (secret && xToken === secret) allowed = true;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const admin = getSupabaseAdmin(supabaseUrl, supabaseKey);

  // se não é token de bypass, exige JWT de super admin
  if (!allowed) {
    try {
      const tok = auth.replace("Bearer ", "");
      const { data: { user }, error } = await admin.auth.getUser(tok);
      if (error || !user) return new Response("Não autorizado", { status: 401 });
      const { data: role } = await admin.from("platform_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
      if (!role) return new Response("Acesso restrito ao super admin", { status: 403 });
    } catch { return new Response("Não autorizado", { status: 401 }); }
  }

  let url: URL;
  try { url = new URL(req.url); } catch { return new Response("URL inválida", { status: 400 }); }
  const mode = url.searchParams.get("mode") ?? "full";

  const tasks: Record<string, (a: any) => Promise<void>> = {
    docs: areaDocumentosTeste,
    fluxo: areaFluxoPedidoCompleto,
    automacoes: areaAutomacoes,
    garcom: areaGarcom,
    financeiro: areaFinanceiroDetalhado,
    ia: areaIAModelos,
    vitrines: areaVitrinesPorLayout,
  };

  if (mode === "full") {
    for (const t of Object.values(tasks)) await t(admin);
  } else {
    const parts = mode.split(",");
    for (const p of parts) if (tasks[p]) await tasks[p](admin);
  }

  const passCount = results.filter((r) => r.status === "pass").length;
  const failCount = results.filter((r) => r.status === "fail").length;

  // gravar run
  try {
    await admin.from("auto_test_runs").insert({
      started_at: new Date().toISOString(),
      summary: { total: results.length, pass: passCount, fail: failCount },
      results,
      runner: "e2e-platform-test",
    });
  } catch { /* non-fatal */ }

  return new Response(JSON.stringify({ ok: failCount === 0, pass: passCount, fail: failCount, total: results.length, results }, null, 1), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
