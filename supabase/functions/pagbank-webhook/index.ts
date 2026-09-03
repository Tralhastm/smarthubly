import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const approved = new Set(["PAID", "AUTHORIZED", "AVAILABLE"]);
const cancelled = new Set(["CANCELED", "CANCELLED", "DECLINED", "REFUNDED"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ received: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await request.json();
    const externalId = String(body?.id || body?.order_id || body?.charges?.[0]?.id || "");
    const reference = String(body?.reference_id || body?.metadata?.order_id || "");
    if (!externalId && !reference) return json({ received: true, ignored: true });
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ received: false, code: "SERVER_MISCONFIGURED" }, 500);
    const db = createClient(url, key);
    const status = String(body?.charges?.[0]?.status || body?.status || "WAITING").toUpperCase();
    const eventId = `pagbank:${externalId || reference}:${status}`;
    const registered = await db.rpc("register_webhook_event", { _provider: "pagbank", _event_id: eventId, _event_type: status, _payload: body });
    if (registered.error) return json({ received: false, code: "IDEMPOTENCY_REGISTRATION_FAILED" }, 500);
    if (registered.data === false) return json({ received: true, duplicate: true });
    let order: any = null;
    if (reference) order = (await db.from("orders").select("id,tenant_id,status,total,payment_method,payment_external_id").eq("id", reference).maybeSingle()).data;
    if (!order && externalId) order = (await db.from("orders").select("id,tenant_id,status,total,payment_method,payment_external_id").eq("payment_external_id", externalId).maybeSingle()).data;
    if (!order) return json({ received: true, ignored: true, reason: "order_not_found" });
    const nextStatus = approved.has(status) ? "received" : cancelled.has(status) ? "cancelled" : "pending_payment";
    const update: Record<string, unknown> = { payment_provider: "pagbank", payment_external_id: externalId || order.payment_external_id, metadata: { pagbank_event_id: eventId, pagbank_status: status } };
    if (order.status === "pending_payment" || nextStatus === "cancelled") update.status = nextStatus;
    if (nextStatus === "received") update.payment_confirmed_at = new Date().toISOString();
    const saved = await db.from("orders").update(update).eq("id", order.id);
    if (saved.error) return json({ received: false, code: "ORDER_UPDATE_FAILED" }, 500);
    await db.from("payment_transactions").update({ status: nextStatus === "received" ? "paid" : nextStatus, external_id: update.payment_external_id, raw_webhook: body }).eq("provider", "pagbank").eq("order_id", order.id);
    return json({ received: true, order_id: order.id, status: update.status || order.status });
  } catch (error) {
    console.error("[pagbank-webhook] unexpected error", error);
    return json({ received: false, code: "INTERNAL_ERROR" }, 500);
  }
});
