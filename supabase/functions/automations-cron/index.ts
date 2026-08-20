// Cron central das automações (roda 1x/hora).
// Para cada tenant ativo, executa SOMENTE as automações com toggle = true.
// Implementa: #3 low_stock_promo, #6 reorder_catalog, #9 credit_reminders, #10 weekly_report,
// #11 categorize_nightly, #12 combo_suggestion, #14 peak_alert, #25 phantom_alert.
// Todas as ações criam registros em automation_suggestions (lojista valida no painel)
// ou disparam emails diretos quando aplicável.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

async function logRun(supa: any, tenant_id: string | null, type: string, status: string, metrics: any, error?: string) {
  try {
    await supa.from("automation_runs").insert({ tenant_id, automation_type: type, status, metrics, error_message: error || null });
  } catch (e) { console.error("logRun fail", e); }
}

async function suggest(supa: any, tenant_id: string, type: string, title: string, description: string, payload: any) {
  // evita duplicatas pendentes do mesmo type+payload nas últimas 24h
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: dup } = await supa.from("automation_suggestions")
    .select("id").eq("tenant_id", tenant_id).eq("type", type).eq("status", "pending")
    .gte("created_at", since).limit(1);
  if (dup && dup.length > 0) return false;
  await supa.from("automation_suggestions").insert({ tenant_id, type, title, description, payload, status: "pending" });
  return true;
}

// ============ #3 low_stock_promo ============
async function runLowStockPromo(supa: any, tenant: any) {
  const { data: products } = await supa.from("products")
    .select("id, name, price, stock_quantity, category")
    .eq("tenant_id", tenant.id)
    .not("stock_quantity", "is", null)
    .gt("stock_quantity", 0)
    .lte("stock_quantity", 5)
    .limit(10);
  let created = 0;
  for (const p of products || []) {
    const ok = await suggest(supa, tenant.id, "low_stock_promo",
      `Promoção sugerida: ${p.name}`,
      `Restam ${p.stock_quantity} unidades. Que tal 15% off pra girar o estoque?`,
      { product_id: p.id, suggested_discount_percent: 15, current_stock: p.stock_quantity });
    if (ok) created++;
  }
  return { products_checked: products?.length || 0, suggestions_created: created };
}

// ============ #6 reorder_catalog (por vendas últimos 30 dias) ============
async function runReorderCatalog(supa: any, tenant: any) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: orders } = await supa.from("orders")
    .select("id, order_items(product_name, quantity)")
    .eq("tenant_id", tenant.id)
    .in("status", ["delivered", "out-for-delivery", "preparing"])
    .gte("created_at", since)
    .limit(1000);
  const sales: Record<string, number> = {};
  for (const o of orders || []) {
    for (const it of (o.order_items || [])) {
      sales[it.product_name] = (sales[it.product_name] || 0) + Number(it.quantity || 1);
    }
  }
  const top5 = Object.entries(sales).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top5.length === 0) return { top: 0, suggestions_created: 0 };
  const created = await suggest(supa, tenant.id, "reorder_catalog",
    `Top 5 mais vendidos (últimos 30 dias)`,
    `Coloque esses produtos no topo do cardápio pra acelerar conversão: ${top5.map(([n, q]) => `${n} (${q})`).join(", ")}`,
    { top_products: top5.map(([name, qty]) => ({ name, qty })) });
  return { top: top5.length, suggestions_created: created ? 1 : 0 };
}

// ============ #9 credit_reminders ============
async function runCreditReminders(supa: any, tenant: any) {
  const { data: due } = await supa.from("credit_accounts")
    .select("id, customer_email, customer_name, due_date, amount, amount_paid, reminders_sent, last_reminder_at")
    .eq("tenant_id", tenant.id)
    .in("status", ["open", "overdue"])
    .not("customer_email", "is", null).neq("customer_email", "")
    .limit(50);
  let sent = 0;
  for (const acc of due || []) {
    if (Number(acc.amount_paid) >= Number(acc.amount)) continue;
    const lastH = acc.last_reminder_at ? (Date.now() - new Date(acc.last_reminder_at).getTime()) / 3600000 : 999;
    const dueT = new Date(acc.due_date).getTime();
    const daysOver = Math.floor((Date.now() - dueT) / 86400000);
    // 3d antes do vencimento, no dia, +3d, +7d, +15d, +30d depois
    const targets = [-3, 0, 3, 7, 15, 30];
    if (!targets.includes(daysOver)) continue;
    if (lastH < 20) continue; // não manda 2x no mesmo dia
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-unified/send-credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ credit_account_id: acc.id }),
      });
      if (r.ok) sent++;
    } catch (e) { console.error("credit reminder fail", e); }
  }
  return { eligible: due?.length || 0, sent };
}

// ============ #10 weekly_report (segundas, 8h) ============
async function runWeeklyReport(supa: any, tenant: any, opts?: { force?: boolean }) {
  const now = new Date();
  if (!opts?.force && (now.getDay() !== 1 || now.getUTCHours() !== 11)) return { skipped: "not_monday_8am_brt" };

  const weekMs = 7 * 86400000;
  const thisStart = new Date(Date.now() - weekMs);
  const prevStart = new Date(Date.now() - 2 * weekMs);

  // pega 14 dias para comparar semana atual vs anterior
  const { data: allOrders } = await supa.from("orders")
    .select("id, total, status, created_at, payment_method, customer_phone, customer_name, order_items(product_name, product_price, quantity)")
    .eq("tenant_id", tenant.id).gte("created_at", prevStart.toISOString());

  const orders = (allOrders || []).filter((o: any) => new Date(o.created_at) >= thisStart);
  const prevOrders = (allOrders || []).filter((o: any) => {
    const d = new Date(o.created_at); return d >= prevStart && d < thisStart;
  });

  const delivered = orders.filter((o: any) => o.status === "delivered");
  const prevDelivered = prevOrders.filter((o: any) => o.status === "delivered");
  const revenue = delivered.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const prevRevenue = prevDelivered.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const cancelled = orders.filter((o: any) => o.status === "cancelled").length;
  const prevCancelled = prevOrders.filter((o: any) => o.status === "cancelled").length;
  const avgTicket = delivered.length > 0 ? revenue / delivered.length : 0;
  const prevAvgTicket = prevDelivered.length > 0 ? prevRevenue / prevDelivered.length : 0;
  const cancelRate = orders.length > 0 ? (cancelled / orders.length) * 100 : 0;
  const prevCancelRate = prevOrders.length > 0 ? (prevCancelled / prevOrders.length) * 100 : 0;

  const pct = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);

  // série diária (7 dias)
  const daily: Array<{ label: string; date: string; revenue: number; orders: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const dStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dEnd = new Date(dStart.getTime() + 86400000);
    const dOrders = delivered.filter((o: any) => {
      const d = new Date(o.created_at); return d >= dStart && d < dEnd;
    });
    daily.push({
      label: dStart.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      date: dStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      revenue: dOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0),
      orders: dOrders.length,
    });
  }
  const peakDay = [...daily].sort((a, b) => b.revenue - a.revenue)[0];

  // pico de horário (BRT = UTC-3)
  const hourBuckets: Record<number, number> = {};
  for (const o of delivered) {
    const h = (new Date(o.created_at).getUTCHours() + 24 - 3) % 24;
    hourBuckets[h] = (hourBuckets[h] || 0) + 1;
  }
  const peakHourEntry = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0];
  const peakHour = peakHourEntry ? { hour: Number(peakHourEntry[0]), count: peakHourEntry[1] } : null;

  // top produtos com receita
  const prodMap: Record<string, { qty: number; revenue: number }> = {};
  for (const o of delivered) {
    for (const it of (o.order_items || [])) {
      const cur = prodMap[it.product_name] || { qty: 0, revenue: 0 };
      cur.qty += Number(it.quantity || 1);
      cur.revenue += Number(it.product_price || 0) * Number(it.quantity || 1);
      prodMap[it.product_name] = cur;
    }
  }
  const topProducts = Object.entries(prodMap)
    .sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }));

  // formas de pagamento
  const payMap: Record<string, { count: number; revenue: number }> = {};
  for (const o of delivered) {
    const k = (o.payment_method || 'outro').toLowerCase();
    const cur = payMap[k] || { count: 0, revenue: 0 };
    cur.count++; cur.revenue += Number(o.total || 0);
    payMap[k] = cur;
  }
  const payments = Object.entries(payMap).map(([method, v]) => ({
    method, count: v.count, revenue: v.revenue,
    pctRevenue: revenue > 0 ? (v.revenue / revenue) * 100 : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  // clientes: novos vs recorrentes (na semana). Recorrente = phone aparece em prevOrders ou em pedido anterior à semana
  const phonesThisWeek = new Set<string>();
  delivered.forEach((o: any) => o.customer_phone && phonesThisWeek.add(o.customer_phone));
  // checa histórico antes de thisStart
  const { data: oldPhones } = await supa.from("orders")
    .select("customer_phone").eq("tenant_id", tenant.id)
    .lt("created_at", thisStart.toISOString())
    .in("customer_phone", Array.from(phonesThisWeek).slice(0, 200));
  const recurringSet = new Set((oldPhones || []).map((o: any) => o.customer_phone));
  const newCustomers = Array.from(phonesThisWeek).filter(p => !recurringSet.has(p)).length;
  const returningCustomers = Array.from(phonesThisWeek).filter(p => recurringSet.has(p)).length;

  // top 3 clientes da semana
  const custMap: Record<string, { name: string; orders: number; revenue: number }> = {};
  for (const o of delivered) {
    const k = o.customer_phone || o.customer_name || 'anon';
    const cur = custMap[k] || { name: o.customer_name || 'Cliente', orders: 0, revenue: 0 };
    cur.orders++; cur.revenue += Number(o.total || 0);
    custMap[k] = cur;
  }
  const topCustomers = Object.values(custMap).sort((a, b) => b.revenue - a.revenue).slice(0, 3);

  // fiado em aberto
  const { data: fiadoOpen } = await supa.from("credit_accounts")
    .select("amount, amount_paid, due_date").eq("tenant_id", tenant.id).in("status", ["open", "overdue"]);
  let fiadoTotal = 0, fiadoOverdue = 0;
  for (const c of fiadoOpen || []) {
    const remaining = Number(c.amount || 0) - Number(c.amount_paid || 0);
    if (remaining > 0) {
      fiadoTotal += remaining;
      if (c.due_date && new Date(c.due_date) < new Date()) fiadoOverdue += remaining;
    }
  }

  // produtos sem estoque
  const { count: outOfStock } = await supa.from("products")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id).eq("stock_quantity", 0);

  // diagnóstico (semáforo)
  const revDelta = pct(revenue, prevRevenue);
  const ordersDelta = pct(delivered.length, prevDelivered.length);
  const cancelDelta = cancelRate - prevCancelRate;
  let healthScore = 50;
  if (revDelta > 10) healthScore += 20; else if (revDelta > 0) healthScore += 10; else if (revDelta < -20) healthScore -= 25; else if (revDelta < 0) healthScore -= 10;
  if (cancelRate < 5) healthScore += 15; else if (cancelRate < 15) healthScore += 5; else healthScore -= 15;
  if (returningCustomers > newCustomers) healthScore += 10;
  if ((outOfStock || 0) > 10) healthScore -= 10;
  if (fiadoOverdue > revenue * 0.3) healthScore -= 10;
  healthScore = Math.max(0, Math.min(100, healthScore));
  const healthLabel = healthScore >= 75 ? "Excelente" : healthScore >= 55 ? "Bom" : healthScore >= 35 ? "Atenção" : "Crítico";

  // insights via IA (não bloqueante)
  let aiInsights: Array<{ type: string; title: string; text: string }> = [];
  try {
    const aiController = new AbortController();
    const aiTimeout = setTimeout(() => aiController.abort(), 2500);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/finance-unified/insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      signal: aiController.signal,
      body: JSON.stringify({
        storeName: tenant.name,
        weekRevenue: revenue, prevWeekRevenue: prevRevenue, revenueDeltaPct: revDelta,
        weekOrders: delivered.length, prevWeekOrders: prevDelivered.length, ordersDeltaPct: ordersDelta,
        cancelRatePct: cancelRate, prevCancelRatePct: prevCancelRate,
        avgTicket, prevAvgTicket,
        peakDay: peakDay ? `${peakDay.label} ${peakDay.date}` : null,
        peakHour: peakHour ? `${peakHour.hour}h` : null,
        topProducts: topProducts.slice(0, 3).map(p => p.name),
        newCustomers, returningCustomers,
        outOfStockCount: outOfStock || 0,
        fiadoOpen: fiadoTotal, fiadoOverdue,
        healthScore, healthLabel,
      }),
    });
    clearTimeout(aiTimeout);
    if (r.ok) { const j = await r.json(); aiInsights = j.insights || []; }
  } catch (e) { console.error("weekly ai insights fail", e); }

  // recomendações algorítmicas (rules-based) — sempre presentes
  const recs: string[] = [];
  if (revDelta < -10) recs.push(`Faturamento caiu ${Math.abs(revDelta).toFixed(0)}% vs semana anterior. Considere uma promoção relâmpago no produto top: ${topProducts[0]?.name || '—'}.`);
  if (revDelta > 15) recs.push(`Crescimento forte de ${revDelta.toFixed(0)}% — replique o que funcionou: confira pico em ${peakDay?.label} ${peakDay?.date} (${fmtBRLn(peakDay?.revenue || 0)}).`);
  if (cancelRate > 15) recs.push(`Taxa de cancelamento alta (${cancelRate.toFixed(1)}%). Revise tempos de entrega e disponibilidade de estoque.`);
  if ((outOfStock || 0) > 10) recs.push(`${outOfStock} produtos sem estoque. Reponha pra não perder venda — clientes desistem quando não acham o que querem.`);
  if (fiadoOverdue > 0) recs.push(`${fmtBRLn(fiadoOverdue)} em fiado VENCIDO. Mande lembrete pelos botões na aba Fiado.`);
  if (newCustomers > returningCustomers * 2) recs.push(`Muitos clientes novos (${newCustomers}) e poucos voltando (${returningCustomers}). Crie um cupom de fidelidade pra quem comprou esta semana.`);
  if (returningCustomers > newCustomers * 2) recs.push(`Base fiel forte (${returningCustomers} recorrentes). Foque em aquisição: poste mais nas redes ou peça indicação aos clientes top.`);
  if (peakHour && peakHour.count > delivered.length * 0.25) recs.push(`Pico concentrado às ${peakHour.hour}h (${peakHour.count} pedidos). Reforce equipe e estoque nesse horário.`);
  if (recs.length === 0) recs.push("Operação estável. Continue monitorando estoque, ticket médio e satisfação.");

  await suggest(supa, tenant.id, "weekly_report",
    `Relatório semanal — ${delivered.length} pedidos, R$ ${revenue.toFixed(2)}`,
    `Saúde: ${healthLabel} (${healthScore}/100). ${revDelta >= 0 ? '+' : ''}${revDelta.toFixed(1)}% vs semana anterior.`,
    { period_start: thisStart.toISOString(), revenue, delivered: delivered.length, healthScore });

  let emailed = false;
  if (tenant.billing_email && tenant.transactional_emails_enabled !== false) {
    try {
      const idempotencyKey = opts?.force
        ? `weekly-report-manual-${tenant.id}-${now.toISOString()}-${crypto.randomUUID()}`
        : `weekly-report-${tenant.id}-${now.toISOString().slice(0, 10)}`;
      const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-unified/send-transactional`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          templateName: "weekly-report",
          recipientEmail: tenant.billing_email,
          idempotencyKey,
          templateData: {
            tenantName: tenant.name,
            periodStart: thisStart.toISOString(),
            periodEnd: now.toISOString(),
            totalOrders: orders.length,
            delivered: delivered.length,
            cancelled, cancelRate,
            revenue, avgTicket,
            prevRevenue, prevDelivered: prevDelivered.length, prevAvgTicket, prevCancelRate,
            revDelta, ordersDelta, cancelDelta,
            daily, peakDay, peakHour,
            topProducts, payments,
            newCustomers, returningCustomers, topCustomers,
            fiadoTotal, fiadoOverdue, outOfStock: outOfStock || 0,
            healthScore, healthLabel,
            aiInsights, recommendations: recs,
          },
        }),
      });
      emailed = r.ok;
    } catch (e) { console.error("weekly email fail", e); }
  }
  return { revenue, delivered: delivered.length, healthScore, emailed };
}

const fmtBRLn = (v: number) => `R$ ${Number(v || 0).toFixed(2)}`;

// ============ #11 categorize_nightly (3h da manhã) ============
async function runCategorizeNightly(supa: any, tenant: any) {
  if (new Date().getUTCHours() !== 6) return { skipped: "not_3am_brt" }; // 3h BRT = 6h UTC
  const { data: items } = await supa.from("products")
    .select("id, name, description, category")
    .eq("tenant_id", tenant.id).eq("auto_categorize", true)
    .or("category.is.null,category.eq.,category.eq.Geral")
    .limit(50);
  if (!items || items.length === 0) return { uncategorized: 0 };
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/finance-unified/auto-categorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ items, context: tenant.name }),
    });
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.results)) return { uncategorized: items.length, ai_failed: true };
    let updated = 0;
    for (const res of j.results) {
      if (!res.id || !res.category) continue;
      await supa.from("products").update({ category: res.category, subcategory: res.subcategory || "" }).eq("id", res.id).eq("tenant_id", tenant.id);
      updated++;
    }
    return { uncategorized: items.length, updated };
  } catch (e: any) { return { uncategorized: items.length, error: e.message }; }
}

// ============ #12 combo_suggestion (busca pares co-comprados) ============
async function runComboSuggestion(supa: any, tenant: any) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: orders } = await supa.from("orders")
    .select("id, order_items(product_name)")
    .eq("tenant_id", tenant.id).in("status", ["delivered", "out-for-delivery", "preparing"])
    .gte("created_at", since).limit(500);
  const pairs: Record<string, number> = {};
  for (const o of orders || []) {
    const names = [...new Set((o.order_items || []).map((it: any) => it.product_name))].sort();
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const k = `${names[i]} + ${names[j]}`;
        pairs[k] = (pairs[k] || 0) + 1;
      }
    }
  }
  const top3 = Object.entries(pairs).filter(([_, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top3.length === 0) return { combos_found: 0 };
  const created = await suggest(supa, tenant.id, "combo_suggestion",
    `${top3.length} combo(s) sugerido(s)`,
    `Clientes compram juntos: ${top3.map(([k, c]) => `${k} (${c}x)`).join(" • ")}. Crie como combo com 5-10% de desconto.`,
    { pairs: top3.map(([combo, count]) => ({ combo, count })) });
  return { combos_found: top3.length, suggestions_created: created ? 1 : 0 };
}

// ============ #14 peak_alert (compara última hora vs média) ============
async function runPeakAlert(supa: any, tenant: any) {
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const { count: lastHourCount } = await supa.from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id).gte("created_at", oneHourAgo);
  const { count: total14d } = await supa.from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id).gte("created_at", fourteenDaysAgo);
  const avgPerHour = (total14d || 0) / (14 * 24);
  if (avgPerHour < 0.5) return { skipped: "low_volume_tenant" };
  if ((lastHourCount || 0) < 3) return { last_hour: lastHourCount || 0, avg: avgPerHour };
  if ((lastHourCount || 0) >= avgPerHour * 3) {
    const created = await suggest(supa, tenant.id, "peak_alert",
      `🔥 Pico de pedidos detectado!`,
      `Última hora: ${lastHourCount} pedidos (média normal: ${avgPerHour.toFixed(1)}/h). Confira a cozinha e estoque.`,
      { last_hour: lastHourCount, avg_per_hour: avgPerHour, ratio: (lastHourCount || 0) / avgPerHour });
    return { peak: true, last_hour: lastHourCount, avg: avgPerHour, suggestion_created: created ? 1 : 0 };
  }
  return { peak: false, last_hour: lastHourCount, avg: avgPerHour };
}

// ============ Despacha por tenant ============
// Automações compatíveis com modo afiliado (não dependem de venda própria/checkout/estoque/cozinha):
//   - reorder_catalog (ranking de mais vendidos/clicados ainda faz sentido)
//   - weekly_report
//   - categorize_nightly
// Tudo o que envolve estoque, fiado, combos, picos de cozinha, low stock, é skipado em afiliado.
async function runForTenant(supa: any, tenant: any) {
  const out: Record<string, any> = {};
  const isAffiliate = tenant.store_mode === "affiliate";

  if (!isAffiliate && tenant.auto_low_stock_promo) { try { out.low_stock = await runLowStockPromo(supa, tenant); } catch (e: any) { out.low_stock = { error: e.message }; } }
  if (tenant.auto_reorder_catalog) { try { out.reorder = await runReorderCatalog(supa, tenant); } catch (e: any) { out.reorder = { error: e.message }; } }
  if (!isAffiliate && tenant.auto_credit_reminders) { try { out.credit = await runCreditReminders(supa, tenant); } catch (e: any) { out.credit = { error: e.message }; } }
  if (tenant.auto_weekly_report) { try { out.weekly = await runWeeklyReport(supa, tenant); } catch (e: any) { out.weekly = { error: e.message }; } }
  if (tenant.auto_categorize_nightly) { try { out.categorize = await runCategorizeNightly(supa, tenant); } catch (e: any) { out.categorize = { error: e.message }; } }
  if (!isAffiliate && tenant.auto_combo_suggestion) { try { out.combo = await runComboSuggestion(supa, tenant); } catch (e: any) { out.combo = { error: e.message }; } }
  if (!isAffiliate && tenant.auto_peak_alert) { try { out.peak = await runPeakAlert(supa, tenant); } catch (e: any) { out.peak = { error: e.message }; } }
  if (isAffiliate) out.skipped_for_affiliate = ["low_stock_promo", "credit_reminders", "combo_suggestion", "peak_alert"];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supa = admin();
  const startedAt = Date.now();
  const url = new URL(req.url);
  let onlyWeekly = url.searchParams.get("only") === "weekly_report";
  let forceTenant = url.searchParams.get("tenant_id");
  let force = url.searchParams.get("force") === "1";

  // também aceita via body (para invoke do frontend)
  if (req.method === "POST" && !forceTenant) {
    try {
      const body = await req.json();
      if (body?.only === "weekly_report") onlyWeekly = true;
      if (body?.tenant_id) forceTenant = String(body.tenant_id);
      if (body?.force) force = true;
    } catch (_) { /* ignora body inválido */ }
  }

  try {
    let q = supa.from("tenants")
      .select("id, name, store_mode, billing_email, transactional_emails_enabled, auto_low_stock_promo, auto_reorder_catalog, auto_credit_reminders, auto_weekly_report, auto_categorize_nightly, auto_combo_suggestion, auto_peak_alert");
    if (forceTenant) q = q.eq("id", forceTenant);
    const { data: tenants } = await q;

    const summary: any = { tenants_processed: 0, results: {} };
    for (const t of tenants || []) {
      let r: any;
      if (onlyWeekly) {
        r = { weekly: await runWeeklyReport(supa, t, { force }) };
      } else {
        r = await runForTenant(supa, t);
      }
      summary.results[t.id] = { name: t.name, ...r };
      summary.tenants_processed++;
      await logRun(supa, t.id, onlyWeekly ? "weekly_report_manual" : "automations_cron_tick", "success", r);
    }
    summary.duration_ms = Date.now() - startedAt;

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("automations-cron error", e);
    await logRun(supa, null, "automations_cron_tick", "error", {}, e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
