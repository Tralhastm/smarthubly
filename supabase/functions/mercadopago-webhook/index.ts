import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const approved = new Set(["approved"]);
const cancelled = new Set(["rejected", "cancelled", "refunded", "charged_back"]);

async function api(url: string, token: string) {
  const result = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const data = await result.json().catch(() => ({}));
  return { result, data };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return response({ received: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await request.json();
    const isPayment = body?.type === "payment" || body?.action?.startsWith("payment.");
    const isMerchantOrder = body?.topic === "merchant_order" || String(body?.resource || "").includes("merchant_orders");
    if (!isPayment && !isMerchantOrder) return response({ received: true, ignored: true });
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return response({ received: false, code: "SERVER_MISCONFIGURED" }, 500);
    const db = createClient(url, key);
    const eventId = String(body?.id || `${body?.type || body?.topic}:${body?.data?.id || body?.resource || "unknown"}:${body?.action || ""}`);
    const registered = await db.rpc("register_webhook_event", { _provider: "mercadopago", _event_id: eventId, _event_type: body?.type || body?.topic || body?.action || "unknown", _payload: body });
    if (registered.error) return response({ received: false, code: "IDEMPOTENCY_REGISTRATION_FAILED" }, 500);
    if (registered.data === false) return response({ received: true, duplicate: true });

    const tenants = await db.from("tenants").select("id,mercadopago_token").not("mercadopago_token", "is", null);
    let payment: any = null;
    for (const tenant of tenants.data || []) {
      try {
        if (isPayment && body?.data?.id) {
          const found = await api(`https://api.mercadopago.com/v1/payments/${body.data.id}`, tenant.mercadopago_token);
          if (found.result.ok && found.data?.external_reference) { payment = { ...found.data, tenant_id: tenant.id }; break; }
        } else if (isMerchantOrder && body?.resource) {
          const found = await api(String(body.resource), tenant.mercadopago_token);
          if (found.result.ok && found.data?.external_reference) { payment = { ...found.data, tenant_id: tenant.id }; break; }
        }
      } catch (error) { console.error("[mercadopago-webhook] resolve error", error); }
    }
    if (!payment?.external_reference) return response({ received: true, ignored: true, reason: "payment_not_resolved" });
    const orderResult = await db.from("orders").select("id,tenant_id,status,total,payment_method").eq("id", payment.external_reference).maybeSingle();
    const order = orderResult.data;
    if (!order) return response({ received: true, ignored: true, reason: "order_not_found" });
    const paymentStatus = String(payment.status || payment.order_status || "pending").toLowerCase();
    const nextStatus = approved.has(paymentStatus) ? "received" : cancelled.has(paymentStatus) ? "cancelled" : "pending_payment";
    const update: Record<string, unknown> = { payment_provider: "mercadopago", payment_external_id: String(payment.id || body?.data?.id || ""), payment_method: "mercadopago", metadata: { mercadopago_event_id: eventId, mercadopago_status: paymentStatus } };
    if (order.status === "pending_payment" || nextStatus === "cancelled") update.status = nextStatus;
    if (nextStatus === "received") update.payment_confirmed_at = new Date().toISOString();
    const saved = await db.from("orders").update(update).eq("id", order.id);
    if (saved.error) return response({ received: false, code: "ORDER_UPDATE_FAILED" }, 500);
    await db.from("payment_transactions").update({ status: nextStatus === "received" ? "paid" : nextStatus, external_id: update.payment_external_id, raw_webhook: body }).eq("provider", "mercadopago").eq("order_id", order.id);
    return response({ received: true, order_id: order.id, status: update.status || order.status, duplicate: false });
  } catch (error) {
    console.error("[mercadopago-webhook] unexpected error", error);
    return response({ received: false, code: "INTERNAL_ERROR" }, 500);
  }
});
