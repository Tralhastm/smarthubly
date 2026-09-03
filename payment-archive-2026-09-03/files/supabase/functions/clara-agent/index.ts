import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { PLATFORM_KNOWLEDGE } from "../_shared/platform_knowledge.ts";
import { getAuthUser, isTenantAdmin } from "../_shared/auth.ts";
import { callAiStream } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SYSTEM_PROMPT = `Você é a **Clara**, consultora empresarial do lojista. Seu papel é olhar os números reais do negócio dele (vendas, despesas, fiado, estoque, ticket médio, margem) e dar conselho prático, direto e específico.

# PERSONALIDADE
- Tom: consultora amiga, profissional, sem rebuscar. Tipo sócia que entende de número.
- Frases curtas. Direto ao ponto. Zero enrolação.
- Português brasileiro coloquial.
- Máximo 2 emojis por resposta.
- Nunca invente dados. Se não tem o dado, fala "não tenho esse número agora".

# SEU ESCOPO
- Análise de vendas, faturamento, margem, lucro, ticket médio.
- Saldo em caixa, Contas a pagar, Fiado, Estoque, Despesas.
- Pedidos em andamento agora.

# REGRAS DE FORMATAÇÃO
- Texto natural e limpo. Negrito em números críticos.
- Listas com hífen (-), máximo 3 itens.
- NUNCA use # ## ###. Formato de dinheiro R$ X,XX.

# CONHECIMENTO DA PLATAFORMA
${PLATFORM_KNOWLEDGE}`;

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
    supabase.from("orders").select("id, total, status, payment_method, payment_received, customer_name, created_at").eq("tenant_id", tenantId).not("status", "in", "(delivered,cancelled)").order("created_at", { ascending: false }).limit(50)
  ]);

  const tenant = tenantRes.data;
  const isFiado = (o: any) => (o.payment_method || "").toLowerCase() === "fiado";
  const monthOrders = (monthOrdersRes.data || []).filter((o: any) => !isFiado(o));
  const prevOrders = (prevOrdersRes.data || []).filter((o: any) => !isFiado(o));
  
  const monthRevenue = monthOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const prevRevenue = prevOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const monthExpensesAll = monthExpensesRes.data || [];
  const monthExpenses = monthExpensesAll.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  
  const cashOut = monthExpensesAll.filter((e: any) => !(e.is_credit_card === true && e.paid === false)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const cardPending = monthExpensesAll.filter((e: any) => e.is_credit_card === true && e.paid === false).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const cashBalance = monthRevenue - cashOut;
  const availableBalance = cashBalance - cardPending;
  const monthProfit = monthRevenue - monthExpenses;
  const margin = monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0;
  const ticket = monthOrders.length > 0 ? monthRevenue / monthOrders.length : 0;
  const growth = prevRevenue > 0 ? ((monthRevenue - prevRevenue) / prevRevenue) * 100 : 0;

  const productMap = new Map();
  (topItemsRes.data || []).forEach((it: any) => {
    const cur = productMap.get(it.product_name) || { qty: 0, revenue: 0 };
    cur.qty += Number(it.quantity || 0);
    cur.revenue += Number(it.quantity || 0) * Number(it.product_price || 0);
    productMap.set(it.product_name, cur);
  });
  const topProducts = Array.from(productMap.entries()).sort((a: any, b: any) => b[1].revenue - a[1].revenue).slice(0, 5).map(([name, v]) => `  - ${name}: ${v.qty}un, R$ ${v.revenue.toFixed(2)}`);

  const products = productsRes.data || [];
  const lowStock = products.filter((p: any) => Number(p.stock_quantity ?? 0) > 0 && Number(p.stock_quantity) <= 3);
  const outOfStock = products.filter((p: any) => p.in_stock === false || Number(p.stock_quantity ?? 0) <= 0);

  const credits = creditsRes.data || [];
  const fiadoOpen = credits.reduce((s: number, c: any) => s + (Number(c.amount || 0) - Number(c.amount_paid || 0)), 0);
  const fiadoOld = credits.filter((c: any) => {
    const days = (Date.now() - new Date(c.due_date).getTime()) / (1000 * 60 * 60 * 24);
    return days > 30;
  });

  const expByCat = new Map();
  (monthExpensesRes.data || []).forEach((e: any) => {
    expByCat.set(e.category || "outros", (expByCat.get(e.category || "outros") || 0) + Number(e.amount || 0));
  });
  const topExpenses = Array.from(expByCat.entries()).sort((a: any, b: any) => b[1] - a[1]).slice(0, 4).map(([cat, v]) => `  - ${cat}: R$ ${v.toFixed(2)}`);

  const debts = debtsRes.data || [];
  const supplierDebts = debts.filter((d: any) => d.name?.startsWith('🏭') || (d.type || '').toLowerCase().includes('fornec'));
  const supplierDebtTotal = supplierDebts.reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
  const otherDebtTotal = debts.filter((d: any) => !supplierDebts.includes(d)).reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  const openOrders = openOrdersRes.data || [];
  const openByStatus = new Map();
  openOrders.forEach((o: any) => {
    const s = o.status || 'unknown';
    const cur = openByStatus.get(s) || { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(o.total || 0);
    openByStatus.set(s, cur);
  });
  const openSummary = Array.from(openByStatus.entries()).map(([s, v]) => `  - ${s}: ${v.count} pedido${v.count === 1 ? '' : 's'} (R$ ${v.total.toFixed(2)})`).join('\n');
  const pendingPayment = openOrders.filter((o: any) => o.status === 'pending_payment' || o.payment_received === false);
  const recentOpenList = openOrders.slice(0, 8).map((o: any) => `  - ${o.customer_name || '?'}: R$ ${Number(o.total).toFixed(2)} | ${o.status}${o.payment_received === false ? ' (não pago)' : ''}`).join('\n');

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const user = await getAuthUser(req);
    if (!user) return new Response("unauthorized", { status: 401, headers: corsHeaders });

    const { messages, tenantId } = await req.json();
    if (!tenantId) return new Response("tenantId required", { status: 400, headers: corsHeaders });

    const isAdmin = await isTenantAdmin(admin, user.id, tenantId);
    if (!isAdmin) return new Response("forbidden", { status: 403, headers: corsHeaders });

    const bizContext = await loadBusinessContext(admin, tenantId);
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${bizContext}`;

    return await callAiStream(admin, {
      systemPrompt: fullPrompt,
      messages,
      temperature: 0.6,
      maxTokens: 1000
    });

  } catch (e) {
    console.error("[clara-agent] erro:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
