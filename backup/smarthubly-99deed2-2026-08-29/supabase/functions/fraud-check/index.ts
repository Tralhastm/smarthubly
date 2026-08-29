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

  try {
    const { orderId } = await req.json();
    if (!orderId) return new Response(JSON.stringify({ error: "orderId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) return new Response(JSON.stringify({ error: "order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: tenant } = await supabase.from("tenants").select("auto_fraud_check, fraud_strictness").eq("id", order.tenant_id).maybeSingle();
    if (!tenant?.auto_fraud_check) return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const signals: Signal[] = [];
    const phone = (order.customer_phone || "").replace(/\D/g, "");

    // 1) Telefone muito curto / inválido
    if (phone.length < 10) signals.push({ name: "invalid_phone", weight: 30, detail: phone });

    // 2) Endereço vazio em delivery
    if (order.delivery_type === "delivery" && (!order.customer_address || order.customer_address.length < 8)) {
      signals.push({ name: "empty_address_for_delivery", weight: 25 });
    }

    // 3) Pedido > R$ 500 e cliente novo
    const { count: pastOrders } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone)
      .neq("id", orderId);
    if (Number(order.total) > 500 && (pastOrders ?? 0) === 0) signals.push({ name: "high_value_new_customer", weight: 25 });

    // 4) Histórico recente de cancelados/fantasmas pelo mesmo telefone
    const { count: cancelledRecent } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone)
      .eq("status", "cancelled")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
    if ((cancelledRecent ?? 0) >= 2) signals.push({ name: "recent_cancellations", weight: 30, detail: `${cancelledRecent}` });

    // 5) Múltiplos pedidos abertos do mesmo telefone agora
    const { count: openNow } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone)
      .in("status", ["received", "preparing", "out-for-delivery"])
      .neq("id", orderId);
    if ((openNow ?? 0) >= 2) signals.push({ name: "many_concurrent_orders", weight: 20, detail: `${openNow}` });

    // 6) Bloqueios anteriores
    const { count: prevBlocks } = await supabase
      .from("fraud_blocks")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", order.tenant_id)
      .eq("customer_phone", order.customer_phone);
    if ((prevBlocks ?? 0) > 0) signals.push({ name: "previous_fraud_blocks", weight: 40, detail: `${prevBlocks}` });

    const score = signals.reduce((s, x) => s + x.weight, 0);

    const thresholds: Record<string, number> = { low: 80, medium: 60, high: 40 };
    const threshold = thresholds[tenant.fraud_strictness] ?? 60;

    let action: "approved" | "flagged" | "blocked" = "approved";
    if (score >= threshold + 20) action = "blocked";
    else if (score >= threshold) action = "flagged";

    if (action !== "approved") {
      await supabase.from("fraud_blocks").insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        customer_phone: order.customer_phone,
        customer_name: order.customer_name,
        reason: signals.map((s) => s.name).join(", "),
        risk_score: score,
        signals,
        action,
      });

      if (action === "blocked") {
        await supabase
          .from("orders")
          .update({ status: "pending_payment", cancel_reason: `fraud_blocked_score_${score}` })
          .eq("id", order.id);

        await supabase.from("order_events").insert({
          tenant_id: order.tenant_id,
          order_id: order.id,
          event_type: "fraud_blocked",
          actor: "system",
          description: `Pedido bloqueado por anti-fraude (score ${score})`,
          metadata: { signals, score },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, score, action, signals }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
