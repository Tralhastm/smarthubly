import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token, x-asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

const APPROVED = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);
const CANCELLED = new Set(["PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_OVERDUE"]);
const TERMINAL = new Set(["delivered", "cancelled"]);

function extract(body: any) {
  const payment = body?.payment || body?.data?.payment || body?.data || {};
  return {
    event: String(body?.event || body?.type || "").toUpperCase(),
    eventId: String(body?.id || ""),
    paymentId: String(payment?.id || body?.paymentId || ""),
    reference: String(payment?.externalReference || payment?.external_reference || ""),
    paymentStatus: String(payment?.status || "").toUpperCase(),
    payment,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ received: false, code: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ received: false, code: "SERVER_MISCONFIGURED" }, 500);
    const body = await request.json();
    const parsed = extract(body);
    if (!parsed.event || !parsed.paymentId) return json({ received: true, ignored: true, reason: "incomplete_event" });

    const db = createClient(supabaseUrl, serviceKey);
    let order: any = null;
    if (parsed.reference) {
      const byReference = await db.from("orders").select("id,tenant_id,status,total,payment_method,customer_name,payment_external_id").eq("id", parsed.reference).maybeSingle();
      order = byReference.data || null;
    }
    if (!order) {
      const byPayment = await db.from("orders").select("id,tenant_id,status,total,payment_method,customer_name,payment_external_id").eq("payment_external_id", parsed.paymentId).maybeSingle();
      order = byPayment.data || null;
    }
    if (!order) return json({ received: true, ignored: true, reason: "order_not_found" });

    const tenantResult = await db.from("tenants").select("id,asaas_webhook_token").eq("id", order.tenant_id).maybeSingle();
    if (tenantResult.error) return json({ received: false, code: "TENANT_LOOKUP_FAILED" }, 500);
    const expected = String(tenantResult.data?.asaas_webhook_token || Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "");
    const received = request.headers.get("asaas-access-token") || request.headers.get("x-asaas-access-token") || "";
    if (!expected || received !== expected) return json({ received: false, code: "UNAUTHORIZED" }, 401);

    const eventId = parsed.eventId || `${parsed.event}:${parsed.paymentId}`;
    const registered = await db.rpc("register_webhook_event", { _provider: "asaas", _event_id: eventId, _event_type: parsed.event, _payload: body });
    if (registered.error) return json({ received: false, code: "IDEMPOTENCY_REGISTRATION_FAILED" }, 500);
    if (registered.data === false) return json({ received: true, duplicate: true, order_id: order.id });

    const approved = APPROVED.has(parsed.event) || parsed.paymentStatus === "RECEIVED";
    const cancelled = CANCELLED.has(parsed.event) || ["DELETED", "REFUNDED", "OVERDUE"].includes(parsed.paymentStatus);
    const previousStatus = String(order.status || "");
    const nextStatus = approved ? (TERMINAL.has(previousStatus) ? previousStatus : "received") : cancelled && !TERMINAL.has(previousStatus) ? "cancelled" : previousStatus;
    const update: Record<string, unknown> = { payment_provider: "asaas", payment_external_id: parsed.paymentId };
    if (nextStatus !== previousStatus) update.status = nextStatus;
    if (approved) update.payment_confirmed_at = new Date().toISOString();
    const metadata = { asaas_event: parsed.event, asaas_payment_status: parsed.paymentStatus || null, asaas_payment_id: parsed.paymentId, asaas_event_id: eventId };
    update.metadata = metadata;
    const updated = await db.from("orders").update(update).eq("id", order.id);
    if (updated.error) return json({ received: false, code: "ORDER_UPDATE_FAILED" }, 500);

    const transactionStatus = approved ? "paid" : cancelled ? "cancelled" : "pending";
    await db.from("payment_transactions").update({ status: transactionStatus, external_id: parsed.paymentId, raw_webhook: body }).eq("provider", "asaas").eq("order_id", order.id);

    if (approved && previousStatus === "pending_payment") {
      await db.from("order_events").insert({ order_id: order.id, tenant_id: order.tenant_id, event_type: "payment_approved", from_status: previousStatus, to_status: nextStatus, actor: "asaas", description: "Pagamento aprovado via Asaas", metadata: { payment_id: parsed.paymentId, event: parsed.event } });
    }
    return json({ received: true, order_id: order.id, status: nextStatus, duplicate: false });
  } catch (error) {
    console.error("[asaas-webhook] unexpected error", error);
    return json({ received: false, code: "INTERNAL_ERROR" }, 500);
  }
});
