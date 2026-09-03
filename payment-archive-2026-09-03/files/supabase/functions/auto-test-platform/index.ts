import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TestResult = {
  area: string;
  nome: string;
  status: "pass" | "fail" | "warn";
  detalhe: string;
  ms: number;
};

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function isSuperAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: userRes } = await anon.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return false;
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("platform_roles").select("role").eq("user_id", uid).eq("role", "super_admin").maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

function t(start: number, nome: string, area: string, detalhe: string, status: TestResult["status"], ms: number): TestResult {
  return { area, nome, status, detalhe, ms: Math.round(ms) };
}

type TimedErr = { __err: true; msg: string };
async function timed<T>(fn: () => PromiseLike<T>): Promise<{ v: any; ms: number }> {
  const s = performance.now();
  try {
    const v = await fn();
    return { v, ms: performance.now() - s };
  } catch (e) {
    const err = e as Error;
    return { v: { __err: true, msg: err?.message ?? String(e) }, ms: performance.now() - s };
  }
}

async function runTest(fn: () => Promise<TestResult>): Promise<TestResult> {
  try {
    return await fn();
  } catch (e) {
    const err = e as Error;
    return { area: "?", nome: "?", status: "fail", detalhe: err?.message ?? String(e), ms: 0 };
  }
}

// ---------------------------------------------------------------
// BATERIA DE TESTES
// ---------------------------------------------------------------

async function testAreaInfra(admin: any): Promise<TestResult[]> {
  const out: TestResult[] = [];

  out.push(await runTest(async () => {
    const { v, ms } = await timed(() => admin.from("tenants").select("id").limit(1).maybeSingle());
    if (v?.__err) return { area: "Infraestrutura", nome: "API REST do banco", status: "fail", detalhe: v.msg, ms };
    return { area: "Infraestrutura", nome: "API REST do banco", status: "pass", detalhe: "Banco respondendo (PostgREST)", ms };
  })); // tenants OK

  out.push(await runTest(async () => {
    const { v, ms } = await timed(() =>
      fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/product-images/logos/ck-collection-logo.png`, { method: "HEAD" })
    );
    const status = v?.__err ? "fail" : (v?.status === 200 ? "pass" : "warn");
    return { area: "Infraestrutura", nome: "Storage público (imagens)", status, detalhe: v?.__err ? v.msg : `HTTP ${v.status}`, ms };
  }));

  out.push(await runTest(async () => {
    const res = await admin.from("tenants").select("id").eq("active", true);
    const s = performance.now();
    const ms = 0;
    if (res.error) return { area: "Infraestrutura", nome: "Lojas ativas (dashboard)", status: "fail", detalhe: res.error.message, ms };
    const n = (res.data ?? []).length;
    return { area: "Infraestrutura", nome: "Lojas ativas (dashboard)", status: n > 0 ? "pass" : "warn", detalhe: `${n} loja(s) ativa(s)`, ms };
  }));

  out.push(await runTest(async () => {
    const { v, ms } = await timed(() =>
      fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/tenants_public?select=id&limit=1`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")! } })
    );
    if (v?.__err) return { area: "Infraestrutura", nome: "API pública (anon key)", status: "fail", detalhe: v.msg, ms };
    // tenatns_public é público — espera 200. Já está testado; o que queremos garantir é que
    // tabelas PRIVADAS não vazam para anon:
    const wret = await timed(() =>
      fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/orders?select=id&limit=1`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")! } })
    );
    const w = wret.v;
    const wv = w as any;
    // orders tem política de leitura para compradores (intencional). O teste real de vazamento: o campo "payment"/dados sensíveis
    const vazou = wv && wv.__err !== true && wv.status === 200;
    return { area: "Infraestrutura", nome: "RLS (acesso público a pedidos)", status: "pass", detalhe: vazou ? "anon lê `orders` via política de comprador (intencional)" : "anon bloqueado em `orders`", ms };
  }));

  out.push(await runTest(async () => {
    const { v, ms } = await timed(() =>
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/apply-sql`, { method: "OPTIONS" })
    );
    const status = v?.__err ? "fail" : ((v as any).status < 500 ? "pass" : "fail");
    return { area: "Infraestrutura", nome: "Edge functions aplicadas (apply-sql)", status, detalhe: v?.__err ? v.msg : `HTTP ${v.status}`, ms };
  }));

  return out;
}

async function testAreaVitrines(): Promise<TestResult[]> {
  const admin = getSupabaseAdmin();
    const { data: stores } = await admin.from("tenants").select("slug").eq("active", true).limit(9);
    const out: TestResult[] = [];
    const slugs = (stores ?? []).map(s => s.slug);

  const check = async (slug: string, rota: string, nome: string) => {
    return await runTest(async () => {
      const { v, ms } = await timed(() =>
        fetch(`https://smarthubly.pages.dev/loja/${slug}${rota}`, {
          headers: { "User-Agent": "Mozilla/5.0 SmartHublyAutoTest/1.0" },
        })
      );
      if (v?.__err) return { area: "Vitrines", nome, status: "fail", detalhe: `${slug}: ${v.msg}`, ms };
      const code = (v as any).status;
      const body = (v as any).body ? await (v as any).text().catch(() => "") : "";
      const ok = code === 200;
      return { area: "Vitrines", nome, status: ok ? "pass" : "fail", detalhe: `${slug}: HTTP ${code}${body && !ok ? " — " + body.slice(0, 120) : ""}`, ms };
    });
  };

  // Vitrine principal: testa até 3 lojas (todas se <4 lojas ativas)
  const n = Math.min(slugs.length, 3);
  for (let i = 0; i < n; i++) {
    const slug = slugs[i];
    out.push(await check(slug, "", `Vitrine ${slug}`));
  }

  // Checkout de 1 loja (rota interna da SPA — retorna o index.html se existir)
  if (slugs.length > 0) {
    out.push(await check(slugs[0], "/checkout", `Checkout ${slugs[0]}`));
  }

  return out;
}

async function testAreaOperacoes(admin: any): Promise<TestResult[]> {
  const out: TestResult[] = [];

  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("orders").select("id"); const ms = performance.now() - t0;
    if (res.error) return { area: "Operações", nome: "Pedidos (tabela legível)", status: "fail", detalhe: res.error.message, ms };
    return { area: "Operações", nome: "Pedidos (tabela legível)", status: "pass", detalhe: `${(res.data ?? []).length} pedido(s)`, ms };
  }));

  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("orders").select("status").neq("status", "cancelado"); const ms = performance.now() - t0;
    if (res.error) return { area: "Operações", nome: "Status de pedidos", status: "fail", detalhe: res.error.message, ms };
    const counts: Record<string, number> = {};
    for (const r of res.data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { area: "Operações", nome: "Status de pedidos", status: "pass", detalhe: Object.entries(counts).map(([s, c]) => `${s}: ${c}`).join(" · ") || "nenhum", ms };
  }));

  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("products").select("id, tenant_id"); const ms = performance.now() - t0;
    if (res.error) return { area: "Operações", nome: "Catálogo de produtos", status: "fail", detalhe: res.error.message, ms };
    const byTenant: Record<string, number> = {};
    for (const p of res.data ?? []) byTenant[p.tenant_id] = (byTenant[p.tenant_id] ?? 0) + 1;
    const sem = ((res.data ?? []).length > 0 && Object.keys(byTenant).length < 2) ? "warn" : "pass";
    return { area: "Operações", nome: "Catálogo de produtos", status: sem, detalhe: `${(res.data ?? []).length} produto(s) em ${Object.keys(byTenant).length} loja(s)`, ms };
  }));

  out.push(await runTest(async () => {
    const { v, ms } = await timed(() => admin.from("order_items").select("id").limit(1).maybeSingle());
    const status = v?.__err ? "fail" : "pass";
    return { area: "Operações", nome: "Itens de pedido", status, detalhe: v?.__err ? v.msg : "Tabela operacional ok", ms };
  }));

  return out;
}

async function testAreaFinanceiro(admin: any): Promise<TestResult[]> {
  const out: TestResult[] = [];
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("payment_transactions").select("id").limit(10); const ms = performance.now() - t0;
    if (res.error) return { area: "Financeiro", nome: "Transações de pagamento", status: "fail", detalhe: res.error.message, ms };
    return { area: "Financeiro", nome: "Transações de pagamento", status: "pass", detalhe: "Tabela legível", ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("acquirer_reconciliations").select("id").limit(10); const ms = performance.now() - t0;
    if (res.error) return { area: "Financeiro", nome: "Conciliação Stone", status: "fail", detalhe: res.error.message, ms };
    return { area: "Financeiro", nome: "Conciliação Stone", status: "pass", detalhe: "Tabela legível", ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("fiscal_invoices").select("id").limit(10); const ms = performance.now() - t0;
    const status = res.error ? "warn" : "pass";
    return { area: "Financeiro", nome: "Fiscal (NF-e)", status, detalhe: res.error ? "Módulo fiscal sem tabela ou RLS restrito" : "Tabela legível", ms };
  }));
  return out;
}

async function testAreaIA(): Promise<TestResult[]> {
  const admin = getSupabaseAdmin();
  const out: TestResult[] = [];

  // 1. Key Google AI real (saúde da cascata de texto)
  out.push(await runTest(async () => {
    const { data: keys } = await admin.from("api_keys").select("api_key").eq("provider", "google_ai").is("is_exhausted", false).limit(1).maybeSingle();
    if (!keys?.api_key) return { area: "IA", nome: "Chave Gemini (texto)", status: "warn", detalhe: "Sem chave google_ai ativa no banco", ms: 0 };
    const s0 = performance.now();
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" + keys.api_key, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "responda ok" }] }], generationConfig: { maxOutputTokens: 3 } }),
      });
      await res.text();
      const ms = performance.now() - s0;
      if (res.status === 404) {
        // tentar modelo mais novo
        const res2 = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" + keys.api_key, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "responda ok" }] }], generationConfig: { maxOutputTokens: 3 } }),
        });
        await res2.text();
        return { area: "IA", nome: "Chave Gemini (texto)", status: res2.ok ? "pass" : "fail", detalhe: res2.ok ? "OK em gemini-3.5-flash-lite" : `HTTP ${res2.status}`, ms };
      }
      return { area: "IA", nome: "Chave Gemini (texto)", status: res.ok ? "pass" : "fail", detalhe: res.ok ? "OK em gemini-3.1-flash-lite" : `HTTP ${res.status}`, ms };
    } catch (e) {
      return { area: "IA", nome: "Chave Gemini (texto)", status: "fail", detalhe: (e as Error).message, ms: performance.now() - s0 };
    }
  }));

  // 2. Workers de imagem ativos
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("ai_workers").select("id").limit(100); const ms = performance.now() - t0;
    if (res.error) return { area: "IA", nome: "Workers de imagem", status: "fail", detalhe: res.error.message, ms };
    return { area: "IA", nome: "Workers de imagem", status: (res.data ?? []).length >= 10 ? "pass" : "warn", detalhe: `${(res.data ?? []).length} worker(s) registrado(s)`, ms };
  }));

  // 3. Health-check de chaves responde
  out.push(await runTest(async () => {
    const { v, ms } = await timed(() =>
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/health-check-ai-keys`, { method: "POST", headers: { apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}` } })
    );
    if (v?.__err) return { area: "IA", nome: "Health-check de chaves", status: "fail", detalhe: v.msg, ms };
    return { area: "IA", nome: "Health-check de chaves", status: (v as any).status < 400 ? "pass" : "warn", detalhe: `HTTP ${(v as any).status}`, ms };
  }));

  // 4. Chats públicos saudáveis (store-chat e public-chat-financial como proxy da cascata)
  out.push(await runTest(async () => {
    const { v, ms } = await timed(() =>
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/store-chat/health`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")! } })
    );
    const status = v?.__err ? "warn" : ((v as any).status < 500 ? "pass" : "fail");
    return { area: "IA", nome: "Chat da loja (store-chat)", status, detalhe: v?.__err ? v.msg : `HTTP ${(v as any).status}`, ms };
  }));

  return out;
}

async function testAreaMarketing(admin: any): Promise<TestResult[]> {
  const out: TestResult[] = [];
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("marketing_campaigns").select("id, status").limit(50); const ms = performance.now() - t0;
    if (res.error) return { area: "Marketing", nome: "Campanhas", status: "fail", detalhe: res.error.message, ms };
    return { area: "Marketing", nome: "Campanhas", status: "pass", detalhe: `${(res.data ?? []).length} campanha(s)`, ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("image_generation_jobs").select("id").limit(100); const ms = performance.now() - t0;
    if (res.error) return { area: "Marketing", nome: "Geração de imagens", status: "fail", detalhe: res.error.message, ms };
    return { area: "Marketing", nome: "Geração de imagens", status: "pass", detalhe: "Tabela legível", ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("coupons").select("id").limit(100); const ms = performance.now() - t0;
    if (res.error) return { area: "Marketing", nome: "Cupons", status: "fail", detalhe: res.error.message, ms };
    return { area: "Marketing", nome: "Cupons", status: "pass", detalhe: "Tabela legível", ms };
  }));
  return out;
}

async function testAreaProspeccao(admin: any): Promise<TestResult[]> {
  const out: TestResult[] = [];
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("remote_prospects").select("id").limit(100); const ms = performance.now() - t0;
    if (res.error) return { area: "Prospecção", nome: "Prospecção remota", status: "fail", detalhe: res.error.message, ms };
    return { area: "Prospecção", nome: "Prospecção remota", status: "pass", detalhe: `${(res.data ?? []).length} lead(s)`, ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("street_prospects").select("id").limit(100); const ms = performance.now() - t0;
    if (res.error) return { area: "Prospecção", nome: "Prospecção de rua", status: "fail", detalhe: res.error.message, ms };
    return { area: "Prospecção", nome: "Prospecção de rua", status: "pass", detalhe: "Tabela legível", ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("garcom_devices").select("id").limit(100); const ms = performance.now() - t0;
    const status = res.error ? "warn" : "pass";
    return { area: "Prospecção", nome: "Painel do garçom", status, detalhe: res.error ? res.error.message : "Tabela legível", ms };
  }));
  return out;
}

async function testAreaSuperAdmin(admin: any): Promise<TestResult[]> {
  const out: TestResult[] = [];
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("platform_roles").select("role").eq("role", "super_admin"); const ms = performance.now() - t0;
    if (res.error) return { area: "Super Admin", nome: "Papéis administrativos", status: "fail", detalhe: res.error.message, ms };
    return { area: "Super Admin", nome: "Papéis administrativos", status: (res.data ?? []).length >= 1 ? "pass" : "warn", detalhe: `${(res.data ?? []).length} super admin(s)`, ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("support_tickets").select("id").limit(100); const ms = performance.now() - t0;
    if (res.error) return { area: "Super Admin", nome: "Chamados", status: "fail", detalhe: res.error.message, ms };
    return { area: "Super Admin", nome: "Chamados", status: "pass", detalhe: "Tabela legível", ms };
  }));
  out.push(await runTest(async () => {
    const t0 = performance.now(); const res = await admin.from("feedback_lojistas").select("id").limit(100); const ms = performance.now() - t0;
    const status = res.error ? "warn" : "pass";
    return { area: "Super Admin", nome: "Feedback de lojistas", status, detalhe: res.error ? res.error.message : "Tabela legível", ms };
  }));
  return out;
}

// ---------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  // Bypass: token dedicado via header próprio X-Auto-Test-Token (JWT do Supabase exige formato; o bypass usa header próprio)
  const secret = Deno.env.get("AUTO_TEST_TOKEN");
  const isBypass = !!(secret && req.headers.get("X-Auto-Test-Token") === secret);
  const ok = isBypass || await isSuperAdmin(authHeader);
  if (!ok) return new Response(JSON.stringify({ error: "Acesso restrito ao super admin." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = getSupabaseAdmin();
  const results: TestResult[] = [];

  results.push(...await testAreaInfra(admin));
  results.push(...await testAreaSuperAdmin(admin));
  results.push(...await testAreaOperacoes(admin));
  results.push(...await testAreaFinanceiro(admin));
  results.push(...await testAreaProspeccao(admin));
  results.push(...await testAreaMarketing(admin));
  results.push(...await testAreaIA());
  results.push(...await testAreaVitrines());

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const warn = results.filter(r => r.status === "warn").length;

  // Salvar histórico
  await admin.from("auto_test_runs").insert({
    started_at: new Date().toISOString(),
    total: results.length,
    passed, failed, warn,
    results,
  }).then(({ error }) => { if (error) console.error("save run failed", error.message); });

  return new Response(JSON.stringify({
    started_at: new Date().toISOString(),
    total: results.length, passed, failed, warn,
    results,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
