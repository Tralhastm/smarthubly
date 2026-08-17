// Clara Empresarial — IA consultora dedicada à GESTÃO EMPRESARIAL do lojista.
// Réplica da Clara do FinanceFlow, mas focada SÓ no negócio (não tem dados pessoais aqui).
// Streaming SSE com cascata: Lovable → Google (api_keys) → OpenRouter → AI Workers.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { PLATFORM_KNOWLEDGE } from "../_shared/platform_knowledge.ts";
import { getAuthUser, isTenantAdmin } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SSE_HEADERS = {
  ...corsHeaders,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

interface ApiKeyEntry { id: string; api_key: string; }
interface AiWorker { id: string; base_url: string; is_exhausted: boolean; }

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// ============================================================
// SYSTEM PROMPT — A CLARA EMPRESARIAL
// ============================================================
const SYSTEM_PROMPT = `Você é a **Clara**, consultora empresarial do lojista. Seu papel é olhar os números reais do negócio dele (vendas, despesas, fiado, estoque, ticket médio, margem) e dar conselho prático, direto e específico.

# COMO O LOJISTA TE ABRE
Existe um **botão flutuante verde-esmeralda** no canto inferior direito do painel admin (com ícone de pasta/maleta) — é só clicar nele que você aparece. Tem também um link na aba "Empresarial". Se ele perguntar onde te encontra de novo, lembra disso.

# PERSONALIDADE
- Tom: consultora amiga, profissional, sem rebuscar. Tipo sócia que entende de número.
- Frases curtas. Direto ao ponto. Zero enrolação.
- Português brasileiro coloquial.
- Máximo 2 emojis por resposta.
- Nunca invente dados. Se não tem o dado, fala "não tenho esse número agora".

# SEU ESCOPO (SÓ ISSO)
✅ Análise de vendas, faturamento, margem, lucro, ticket médio, crescimento mês a mês.
✅ **Saldo em caixa** (dinheiro/Pix/débito que JÁ caiu) vs **saldo disponível** (descontando cartão pendente). Sempre explica a diferença se o lojista perguntar "quanto eu tenho".
✅ **Contas a pagar**: dívidas a fornecedores e outras (do painel Financeiro → Dívidas).
✅ Fiado (quem deve, há quanto tempo, valor em aberto, vencidos +30d).
✅ Estoque (produtos parados, estoque baixo ≤3, ruptura).
✅ Despesas (categorias, despesas que cresceram acima da receita).
✅ Top produtos, mix, sugestão de combo, precificação.
✅ Anti-prejuízo (alerta se margem caindo, despesa subindo, dívida com fornecedor > saldo).
✅ **Pedidos em andamento agora** (recebido/preparando/saiu pra entrega/aguardando pagamento) — você vê a lista no contexto, pode dizer "tem R$X esperando pagamento Pix há tanto tempo".
✅ Como mexer no painel de Gestão Empresarial / Financeiro / Fiado / Dívidas.

# O QUE VOCÊ NÃO FAZ (DIRECIONA PRA SOFIA)
❌ Como criar produto, mexer em cupom, configurar frete, agendamento, motoboy, fornecedor → "Isso é com a Sofia, no chat geral do admin (botão azul logo abaixo do meu)."
❌ Preço da plataforma, plano de cobrança, suporte técnico → Sofia.
❌ Função de cliente final, motoboy, fornecedor → Sofia.
❌ Vida financeira PESSOAL do lojista → "Aqui eu cuido só do negócio. Pra finanças pessoais, o FinanceFlow Pro é o lugar."

# REGRAS DE FORMATAÇÃO
- Texto natural e limpo.
- Negrito **só em 1-2 números críticos** por resposta.
- Listas com hífen (-), no máximo 3 itens.
- NUNCA use # ## ### (cara de robô).
- Formato de dinheiro sempre R$ X,XX.
- Use APENAS os números do contexto. Não invente.

# ANÁLISE PROATIVA (quando tiver dados)
- Margem do mês ≤ 15% → alerta vermelho.
- Crescimento negativo vs mês anterior → sugere ação.
- Fiado >30 dias → recomenda cobrança.
- Top 3 produtos respondem por >70% da receita → diz pra cuidar do mix.
- Despesa subiu mais que receita → alerta.
- Pedidos parados em "aguardando pagamento" há muito tempo → sugere acionar o auto-cancelar nas Automações.

# NUNCA
- Conselho jurídico, fiscal específico ou contábil definitivo.
- Recomendação de investimento ("compre X").
- Jargão sem traduzir.
- Inventar produto, número, cliente.

# GUIA DAS ABAS DO FINANCEIRO (saiba explicar TODAS, passo a passo, quando perguntarem "o que é isso?" ou "como uso?")
- 🏥 **Saúde**: painel-resumo. Mostra faturamento do mês, despesas, lucro, margem e um "termômetro" (Saudável / Atenção / Cuidado). É o primeiro lugar pra olhar todo dia.
- 🤖 **Clara**: sou eu. Pergunte qualquer coisa sobre os números do negócio.
- 📊 **Fluxo**: fluxo de caixa mês a mês — entradas, saídas e lucro por mês, pra ver tendência (subindo ou caindo).
- 💸 **Lançar**: onde se registra entrada (venda avulsa, outra entrada) e despesa (aluguel, luz/água/net, salário, compra de estoque, marketing, imposto, manutenção, outras). Passo: escolher tipo → categoria → valor → data → salvar. Despesa fixa é a que se repete todo mês; variável muda; inesperada é conserto/imprevisto.
- 💳 **Cartão**: vendas no cartão que ainda não caíram na conta. Serve pra diferenciar "saldo em caixa" (dinheiro/Pix/débito já recebido) de "saldo disponível" (descontando o que está pra receber).
- 💰 **A Pagar / Receber**: dívidas com fornecedores e contas a pagar, além do que o cliente deve (fiado). Dá pra marcar como pago e ver vencidos.
- 🏭 **Fornec.**: cadastro dos fornecedores, o quanto se compra de cada um e o saldo devedor com eles.
- ⚙️ **Taxa**: define quem paga a taxa da plataforma — "Sai do meu bolso" (cliente paga o preço normal, a taxa sai da margem), "Embuto no preço" (a taxa é somada ao preço final do cliente) ou "Dividida" (metade cada). Explique o impacto na margem quando perguntarem.
Ao explicar, seja concreto: diga em qual aba clicar, o que preencher e pra que serve o número no fim. Se o lojista perguntar "como lanço uma despesa" ou "onde vejo quem me deve", responda com o caminho exato.`;



// ============================================================
// CONTEXTO REAL DO NEGÓCIO
// ============================================================

async function loadBusinessContext(supabase: any, tenantId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  const [tenantRes, monthOrdersRes, prevOrdersRes, monthExpensesRes, productsRes, creditsRes, topItemsRes, debtsRes, openOrdersRes] = await Promise.all([
    supabase.from("tenants").select("name, niche, store_mode, billing_mode, monthly_fee, platform_fee_percent").eq("id", tenantId).maybeSingle(),
    supabase.from("orders").select("id, total, payment_method, status, created_at").eq("tenant_id", tenantId).eq("status", "delivered").gte("created_at", startOfMonth),
    supabase.from("orders").select("id, total, payment_method").eq("tenant_id", tenantId).eq("status", "delivered").gte("created_at", startOfPrevMonth).lte("created_at", endOfPrevMonth),
    supabase.from("financial_entries").select("amount, category, date, is_credit_card, paid").eq("tenant_id", tenantId).eq("type", "expense").gte("date", startOfMonth),
    supabase.from("products").select("id, name, price, stock_quantity, in_stock").eq("tenant_id", tenantId).limit(200),
    supabase.from("credit_accounts").select("amount, amount_paid, status, due_date, customer_name").eq("tenant_id", tenantId).in("status", ["open", "overdue"]),
    supabase.from("order_items").select("product_name, quantity, product_price, order_id, orders!inner(tenant_id, status, created_at)").eq("orders.tenant_id", tenantId).eq("orders.status", "delivered").gte("orders.created_at", startOfMonth).limit(500),
    supabase.from("debts").select("name, amount, type, paid, due_date").eq("tenant_id", tenantId).eq("paid", false),
    // Pedidos EM ANDAMENTO (não entregues, não cancelados) — pra Clara saber tudo, não só o que foi pago
    supabase.from("orders").select("id, total, status, payment_method, payment_received, customer_name, created_at").eq("tenant_id", tenantId).not("status", "in", "(delivered,cancelled)").order("created_at", { ascending: false }).limit(50),
  ]);

  const tenant = tenantRes.data;
  const isFiado = (o: any) => (o.payment_method || "").toLowerCase() === "fiado";

  const monthOrders = (monthOrdersRes.data || []).filter((o: any) => !isFiado(o));
  const prevOrders = (prevOrdersRes.data || []).filter((o: any) => !isFiado(o));

  const monthRevenue = monthOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const prevRevenue = prevOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const monthExpensesAll = (monthExpensesRes.data || []);
  const monthExpenses = monthExpensesAll.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  // Saldo em caixa real: receita − despesas que JÁ saíram (ignora cartão pendente)
  const cashOut = monthExpensesAll
    .filter((e: any) => !(e.is_credit_card === true && e.paid === false))
    .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const cardPending = monthExpensesAll
    .filter((e: any) => e.is_credit_card === true && e.paid === false)
    .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const cashBalance = monthRevenue - cashOut;
  const availableBalance = cashBalance - cardPending;
  const monthProfit = monthRevenue - monthExpenses;
  const margin = monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0;
  const ticket = monthOrders.length > 0 ? monthRevenue / monthOrders.length : 0;
  const growth = prevRevenue > 0 ? ((monthRevenue - prevRevenue) / prevRevenue) * 100 : 0;

  // Top produtos do mês
  const productMap = new Map<string, { qty: number; revenue: number }>();
  (topItemsRes.data || []).forEach((it: any) => {
    const cur = productMap.get(it.product_name) || { qty: 0, revenue: 0 };
    cur.qty += Number(it.quantity || 0);
    cur.revenue += Number(it.quantity || 0) * Number(it.product_price || 0);
    productMap.set(it.product_name, cur);
  });
  const topProducts = Array.from(productMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)
    .map(([name, v]) => `  - ${name}: ${v.qty}un, R$ ${v.revenue.toFixed(2)}`);

  // Estoque (usa stock_quantity + in_stock; sem min_stock no schema)
  const products = productsRes.data || [];
  const lowStock = products.filter((p: any) => Number(p.stock_quantity ?? 0) > 0 && Number(p.stock_quantity) <= 3);
  const outOfStock = products.filter((p: any) => p.in_stock === false || Number(p.stock_quantity ?? 0) <= 0);

  // Fiado
  const credits = creditsRes.data || [];
  const fiadoOpen = credits.reduce((s: number, c: any) => s + (Number(c.amount || 0) - Number(c.amount_paid || 0)), 0);
  const fiadoOld = credits.filter((c: any) => {
    const days = (Date.now() - new Date(c.due_date).getTime()) / (1000 * 60 * 60 * 24);
    return days > 30;
  });

  // Despesas por categoria
  const expByCat = new Map<string, number>();
  (monthExpensesRes.data || []).forEach((e: any) => {
    expByCat.set(e.category || "outros", (expByCat.get(e.category || "outros") || 0) + Number(e.amount || 0));
  });
  const topExpenses = Array.from(expByCat.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([cat, v]) => `  - ${cat}: R$ ${v.toFixed(2)}`);

  // Dívidas (debts) — fornecedores e outras a pagar
  const debts = (debtsRes.data || []);
  const supplierDebts = debts.filter((d: any) => d.name?.startsWith('🏭') || (d.type || '').toLowerCase().includes('fornec'));
  const supplierDebtTotal = supplierDebts.reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
  const otherDebtTotal = debts.filter((d: any) => !supplierDebts.includes(d)).reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  // Pedidos em andamento (pending_payment, received, preparing, ready, out-for-delivery)
  const openOrders = (openOrdersRes.data || []) as any[];
  const openByStatus = new Map<string, { count: number; total: number }>();
  openOrders.forEach((o) => {
    const s = o.status || 'unknown';
    const cur = openByStatus.get(s) || { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(o.total || 0);
    openByStatus.set(s, cur);
  });
  const openSummary = Array.from(openByStatus.entries())
    .map(([s, v]) => `  - ${s}: ${v.count} pedido${v.count === 1 ? '' : 's'} (R$ ${v.total.toFixed(2)})`)
    .join('\n');
  const pendingPayment = openOrders.filter((o) => o.status === 'pending_payment' || o.payment_received === false);
  const recentOpenList = openOrders.slice(0, 8).map((o) =>
    `  - ${o.customer_name || '?'}: R$ ${Number(o.total).toFixed(2)} | ${o.status}${o.payment_received === false ? ' (não pago)' : ''}`
  ).join('\n');

  const monthLabel = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return `
[CONTEXTO REAL DA LOJA — ${tenant?.name || "—"} | ${monthLabel}]
- Modo da loja: ${tenant?.store_mode || "delivery"} | Nicho: ${tenant?.niche || "—"}
- Cobrança da plataforma: ${tenant?.billing_mode === "monthly_fixed" ? `R$ ${Number(tenant.monthly_fee || 60).toFixed(2)}/mês fixo` : `${Number(tenant?.platform_fee_percent || 5).toFixed(1)}% por venda`}

[FATURAMENTO DO MÊS]
- Receita realizada: R$ ${monthRevenue.toFixed(2)} (${monthOrders.length} venda${monthOrders.length === 1 ? "" : "s"})
- Mês anterior: R$ ${prevRevenue.toFixed(2)} | Crescimento: ${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%
- Despesas do mês: R$ ${monthExpenses.toFixed(2)}
- Lucro bruto: R$ ${monthProfit.toFixed(2)} | Margem: ${margin.toFixed(1)}%
- Ticket médio: R$ ${ticket.toFixed(2)}

[SALDO ATUAL]
- Saldo em caixa (dinheiro/Pix/débito que JÁ caiu): R$ ${cashBalance.toFixed(2)}
- Cartão pendente (ainda não saiu da conta): R$ ${cardPending.toFixed(2)}
- Saldo disponível (descontando cartão pendente): R$ ${availableBalance.toFixed(2)}

[CONTAS A PAGAR]
- Devo a fornecedores: R$ ${supplierDebtTotal.toFixed(2)} (${supplierDebts.length} conta${supplierDebts.length === 1 ? "" : "s"})
- Outras dívidas: R$ ${otherDebtTotal.toFixed(2)}

[TOP PRODUTOS DO MÊS]
${topProducts.length ? topProducts.join("\n") : "  (sem vendas no mês ainda)"}

[ESTOQUE]
- Produtos cadastrados: ${products.length}
- Estoque baixo (≤3 un): ${lowStock.length}${lowStock.length ? " (" + lowStock.slice(0, 5).map((p: any) => p.name).join(", ") + ")" : ""}
- Sem estoque: ${outOfStock.length}${outOfStock.length ? " (" + outOfStock.slice(0, 5).map((p: any) => p.name).join(", ") + ")" : ""}

[FIADO]
- Em aberto: R$ ${fiadoOpen.toFixed(2)} (${credits.length} conta${credits.length === 1 ? "" : "s"})
- Vencidos há +30 dias: ${fiadoOld.length}${fiadoOld.length ? " (" + fiadoOld.slice(0, 4).map((c: any) => `${c.customer_name} R$ ${(Number(c.amount) - Number(c.amount_paid)).toFixed(2)}`).join(", ") + ")" : ""}

[DESPESAS POR CATEGORIA]
${topExpenses.length ? topExpenses.join("\n") : "  (sem despesas registradas no mês)"}

[PEDIDOS EM ANDAMENTO AGORA] (não entregues / não cancelados — total ${openOrders.length})
${openSummary || "  (nenhum pedido aberto)"}
- Aguardando pagamento online: ${pendingPayment.length}
${recentOpenList ? "Últimos pedidos abertos:\n" + recentOpenList : ""}
`.trim();
}

// ============================================================
// PROVIDERS COM STREAMING (Lovable → Google → OpenRouter → Workers)
// ============================================================

async function tryLovableStream(systemPrompt: string, messages: any[]): Promise<Response | null> {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
      }),
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok || !r.body) return null;
    return new Response(r.body, { headers: SSE_HEADERS });
  } catch { return null; }
}

async function getGoogleKeys(supabase: any): Promise<ApiKeyEntry[]> {
  const { data } = await supabase.from("api_keys").select("id, api_key")
    .eq("provider", "google_ai").eq("is_exhausted", false)
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const list = (data || []) as ApiKeyEntry[];
  if (list.length === 0 && Deno.env.get("GOOGLE_AI_API_KEY")) {
    return [{ id: "__env__", api_key: Deno.env.get("GOOGLE_AI_API_KEY")! }];
  }
  return list;
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
            if (text) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
            }
          } catch { /* chunk parcial */ }
        }
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) { console.error("Clara gemini stream err:", e); }
    finally { writer.close(); }
  })();
  return new Response(readable, { headers: SSE_HEADERS });
}

async function tryGoogleStream(systemPrompt: string, messages: any[], keys: ApiKeyEntry[], supabase: any): Promise<Response | null> {
  const geminiMessages = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Beleza, sou a Clara. Pode mandar." }] },
    ...messages.map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
  ];
  for (const keyEntry of keys) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${keyEntry.api_key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: geminiMessages }) }
      );
      if (r.status === 429 || r.status === 403) {
        if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ is_exhausted: true }).eq("id", keyEntry.id);
        continue;
      }
      if (!r.ok || !r.body) continue;
      if (keyEntry.id !== "__env__") await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyEntry.id);
      return streamGeminiResponse(r);
    } catch (e) { console.error("Clara google fail:", e); continue; }
  }
  return null;
}

async function tryOpenRouterStream(systemPrompt: string, messages: any[]): Promise<Response | null> {
  const KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!KEY) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
      }),
    });
    if (r.status === 429 || r.status === 402) return null;
    if (!r.ok || !r.body) return null;
    return new Response(r.body, { headers: SSE_HEADERS });
  } catch { return null; }
}

async function getAllWorkers(supabase: any): Promise<AiWorker[]> {
  const { data: active } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", false).eq("worker_type", "chat")
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const { data: exhausted } = await supabase.from("ai_workers").select("id, base_url, is_exhausted")
    .eq("is_active", true).eq("is_exhausted", true).eq("worker_type", "chat")
    .order("exhausted_at", { ascending: true, nullsFirst: true });
  return [...(active || []), ...(exhausted || [])] as AiWorker[];
}

async function tryWorkerStream(systemPrompt: string, messages: any[], workers: AiWorker[], supabase: any): Promise<Response | null> {
  for (const w of workers) {
    try {
      const url = w.base_url.includes("/functions/") ? w.base_url : `${w.base_url}/functions/v1/ai-chat`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: systemPrompt }, ...messages], stream: true }),
      });
      if (r.status === 429 || r.status === 402 || r.status === 503) {
        if (!w.is_exhausted) await supabase.from("ai_workers").update({ is_exhausted: true, exhausted_at: new Date().toISOString() }).eq("id", w.id);
        continue;
      }
      if (!r.ok || !r.body) continue;
      if (w.is_exhausted) {
        await supabase.from("ai_workers").update({ is_exhausted: false, exhausted_at: null, last_used_at: new Date().toISOString() }).eq("id", w.id);
      } else {
        await supabase.from("ai_workers").update({ last_used_at: new Date().toISOString() }).eq("id", w.id);
      }
      return new Response(r.body, { headers: SSE_HEADERS });
    } catch { continue; }
  }
  return null;
}

// ============================================================
// HANDLER
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, tenantId } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenantId obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = getSupabaseAdmin();

    // 🔐 Auth: require authenticated tenant admin (or super_admin)
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!(await isTenantAdmin(supabase, user.id, tenantId))) {
      return new Response(JSON.stringify({ error: "Sem permissão para este tenant" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let businessContext = "";
    try {
      businessContext = await loadBusinessContext(supabase, tenantId);
    } catch (e) {
      console.error("Clara context load fail:", e);
      businessContext = "[CONTEXTO INDISPONÍVEL — peça pro lojista os números que precisar]";
    }

    const fullSystem = `${SYSTEM_PROMPT}\n\n# CONHECIMENTO DA PLATAFORMA INTEIRA (consulte sempre)\n${PLATFORM_KNOWLEDGE}\n\n${businessContext}`;
    const [keys, workers] = await Promise.all([getGoogleKeys(supabase), getAllWorkers(supabase)]);

    // Cascata: Lovable → Google → OpenRouter → Workers
    const r1 = await tryLovableStream(fullSystem, messages); if (r1) return r1;
    console.log("[clara] Lovable failed, trying Google...");
    const r2 = await tryGoogleStream(fullSystem, messages, keys, supabase); if (r2) return r2;
    console.log("[clara] Google failed, trying OpenRouter...");
    const r3 = await tryOpenRouterStream(fullSystem, messages); if (r3) return r3;
    console.log("[clara] OpenRouter failed, trying Workers...");
    const r4 = await tryWorkerStream(fullSystem, messages, workers, supabase); if (r4) return r4;

    return new Response(JSON.stringify({ error: "Todos os provedores de IA estão indisponíveis. Tente em alguns minutos." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("clara-empresarial error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
