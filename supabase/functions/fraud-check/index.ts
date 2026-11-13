// #21 — Anti-fraude: chamada após criar pedido, antes de cair na cozinha
// Recebe { orderId } e avalia sinais de fraude. Se risco alto, marca order como 'pending_payment' e cria fraud_block.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Signal { name: string; weight: number; detail?: string }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { orderId } = await req.json();
    if (!orderId) return new Response(JSON.stringify({ error: "orderId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (orderError) throw new Error(`order lookup failed: ${orderError.message}`);
    if (!order) return new Response(JSON.stringify({ error: "order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: tenant, error: tenantError } = await supabase.from("tenants").select("auto_fraud_check, fraud_strictness").eq("id", order.tenant_id).maybeSingle();
    if (tenantError) throw new Error(`tenant lookup failed: ${tenantError.message}`);
    if (!["pending_review", "pending_payment"].includes(order.status) || order.metadata?.fraud_check_pending !== true) {
      return new Response(JSON.stringify({ error: "order is not eligible for fraud screening" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!tenant?.auto_fraud_check) {
      if (order.metadata?.fraud_check_pending === true) {
        const nextStatus = order.status === "pending_review" ? "received" : order.status;
        const { error: releaseError } = await supabase.from("orders")
          .update({ status: nextStatus, metadata: { ...(order.metadata || {}), fraud_check_pending: false } })
          .eq("id", order.id)
          .eq("tenant_id", order.tenant_id)
          .eq("status", order.status);
        if (releaseError) throw new Error(`order release after skipped fraud check failed: ${releaseError.message}`);
      }
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: previousBlock, error: previousBlockError } = await supabase.from("fraud_blocks")
      .select("id,action,risk_score,signals")
      .eq("order_id", orderId)
      .limit(1)
      .maybeSingle();
    if (previousBlockError) throw new Error(`fraud block lookup failed: ${previousBlockError.message}`);
    if (previousBlock) {
      return new Response(JSON.stringify({ ok: true, duplicate: true, score: previousBlock.risk_score, action: previousBlock.action, signals: previousBlock.signals }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signals: Signal[] = [];
    const phone = (order.customer_phone || "").replace(/\D/g, "");

    // 1) Telefone muito curto / inválido
    if (phone.length < 10) signals.push({ name: "invalid_phone", weight: 30, detail: phone });

    // 2) Endereço vazio em delivery
    if (order.delivery_type === "delivery" && (!order.customer_address || order.customer_address.length < 8)) {
      signals.push({ name: "empty_address_for_delivery", weight: 25 });
    }

    // 3) Pedido > R$ 500 e cliente novo
    const { count: pastOrders, error: pastOrdersError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone)
      .neq("id", orderId);
    if (pastOrdersError) throw new Error(`past orders query failed: ${pastOrdersError.message}`);
    if (Number(order.total) > 500 && (pastOrders ?? 0) === 0) signals.push({ name: "high_value_new_customer", weight: 25 });

    // 4) Histórico recente de cancelados/fantasmas pelo mesmo telefone
    const { count: cancelledRecent, error: cancelledError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone)
      .eq("status", "cancelled")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
    if (cancelledError) throw new Error(`cancellations query failed: ${cancelledError.message}`);
    if ((cancelledRecent ?? 0) >= 2) signals.push({ name: "recent_cancellations", weight: 30, detail: `${cancelledRecent}` });

    // 5) Múltiplos pedidos abertos do mesmo telefone agora
    const { count: openNow, error: openOrdersError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone)
      .in("status", ["received", "preparing", "out-for-delivery"])
      .neq("id", orderId);
    if (openOrdersError) throw new Error(`open orders query failed: ${openOrdersError.message}`);
    if ((openNow ?? 0) >= 2) signals.push({ name: "many_concurrent_orders", weight: 20, detail: `${openNow}` });

    // 6) Bloqueios anteriores
    const { count: prevBlocks, error: blocksError } = await supabase
      .from("fraud_blocks")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone);
    if (blocksError) throw new Error(`previous blocks query failed: ${blocksError.message}`);
    if ((prevBlocks ?? 0) > 0) signals.push({ name: "previous_fraud_blocks", weight: 40, detail: `${prevBlocks}` });

    const score = signals.reduce((s, x) => s + x.weight, 0);

    const thresholds: Record<string, number> = { low: 80, medium: 60, high: 40 };
    const threshold = thresholds[tenant.fraud_strictness] ?? 60;

    let action: "approved" | "flagged" | "blocked" = "approved";
    if (score >= threshold + 20) action = "blocked";
    else if (score >= threshold) action = "flagged";

    if (action !== "approved") {
      const { error: insertBlockError } = await supabase.from("fraud_blocks").insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        customer_phone: order.customer_phone,
        customer_name: order.customer_name,
        reason: signals.map((s) => s.name).join(", "),
        risk_score: score,
        signals,
        action,
      });
      if (insertBlockError) throw new Error(`fraud block insert failed: ${insertBlockError.message}`);

      // Suspeita ou bloqueio não pode entrar na fila operacional antes da
      // aprovação manual. Também é o fallback seguro se o checkout perder a resposta.
      if (order.status !== "pending_review") {
        const { error: holdError } = await supabase
          .from("orders")
          .update({ status: "pending_review", cancel_reason: `fraud_${action}_score_${score}` })
          .eq("id", order.id)
          .eq("tenant_id", order.tenant_id);
        if (holdError) throw new Error(`order hold failed: ${holdError.message}`);

      }
      const { error: eventError } = await supabase.from("order_events").insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        event_type: action === "blocked" ? "fraud_blocked" : "fraud_flagged",
        actor: "system",
        description: `Pedido retido para análise antifraude (score ${score})`,
        metadata: { signals, score, action },
      });
      if (eventError) console.error("fraud order event failed", eventError.message);
    } else if (order.metadata?.fraud_check_pending === true) {
      // Só libera a retenção que este check criou; não remove revisões manuais.
      const nextStatus = order.status === "pending_review" ? "received" : order.status;
      const { error: approveError } = await supabase.from("orders")
        .update({ status: nextStatus, metadata: { ...(order.metadata || {}), fraud_check_pending: false } })
        .eq("id", order.id)
        .eq("tenant_id", order.tenant_id)
        .eq("status", "pending_review");
      if (approveError) throw new Error(`fraud approval update failed: ${approveError.message}`);
    }

    return new Response(JSON.stringify({ ok: true, score, action, signals }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
