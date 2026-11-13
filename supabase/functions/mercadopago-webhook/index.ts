import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const approved = new Set(["approved"]);
const reversed = new Set(["refunded", "charged_back", "chargeback"]);

async function api(url: string, token: string) {
  const result = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const data = await result.json().catch(() => ({}));
  return { result, data };
}

const money = (value: unknown) => Math.round(Number(value || 0) * 100);

async function validMercadoPagoSignature(request: Request, body: any, secret: string) {
  const signatureHeader = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const dataId = new URL(request.url).searchParams.get("data.id") || String(body?.data?.id || "");
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, value.join("=")];
  }));
  if (!parts.ts || !parts.v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== parts.v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return response({ received: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await request.json();
    const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
    if (webhookSecret && !(await validMercadoPagoSignature(request, body, webhookSecret))) {
      return response({ received: false, code: "INVALID_SIGNATURE" }, 401);
    }
    const isMerchantOrder = body?.topic === "merchant_order" || String(body?.resource || "").includes("merchant_orders");
    const isPayment = body?.type === "payment" || String(body?.action || "").startsWith("payment.");
    if (!isPayment && !isMerchantOrder) return response({ received: true, ignored: true });
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return response({ received: false, code: "SERVER_MISCONFIGURED" }, 500);
    const db = createClient(url, key);
    const resourceId = String(body?.data?.id || body?.id || "");
    if (!resourceId) return response({ received: true, ignored: true, reason: "resource_id_missing" });

    // Resolve the event by fetching canonical data from Mercado Pago using each
    // tenant's credential. Never trust payment status, amount, or reference in POST body.
    const { data: tenants, error: tenantsError } = await db.from("tenants")
      .select("id,mercadopago_token,mercadopago_sandbox_token,mercadopago_production_token,mercadopago_environment,auto_confirm_paid_orders,auto_confirm_card_payments")
      .or("mercadopago_token.not.is.null,mercadopago_sandbox_token.not.is.null,mercadopago_production_token.not.is.null");
    if (tenantsError) return response({ received: false, code: "TENANT_LOOKUP_FAILED" }, 500);

    let payment: any = null;
    let resolvedTenant: any = null;
    for (const tenant of tenants || []) {
      try {
        const token = tenant.mercadopago_environment === "production"
          ? (tenant.mercadopago_production_token || tenant.mercadopago_token)
          : (tenant.mercadopago_sandbox_token || tenant.mercadopago_token);
        if (!token) continue;
        const endpoint = isMerchantOrder
          ? `https://api.mercadopago.com/merchant_orders/${encodeURIComponent(resourceId)}`
          : `https://api.mercadopago.com/v1/payments/${encodeURIComponent(resourceId)}`;
        const found = await api(endpoint, token);
        if (!found.result.ok) continue;
        const candidate = found.data;
        if (isMerchantOrder) {
          const providerPayments = Array.isArray(candidate?.payments) ? candidate.payments : [];
          for (const item of providerPayments) {
            if (!item?.id) continue;
            const paymentResult = await api(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(item.id))}`, token);
            if (paymentResult.result.ok && paymentResult.data?.external_reference) {
              payment = paymentResult.data;
              break;
            }
          }
        } else if (candidate?.external_reference) {
          payment = candidate;
        }
        if (!payment?.external_reference) continue;
        resolvedTenant = tenant;
        break;
      } catch (error) { console.error("[mercadopago-webhook] provider verification error", error); }
    }
    if (!payment || !resolvedTenant) return response({ received: true, ignored: true, reason: "provider_resource_not_verified" });

    const orderResult = await db.from("orders")
      .select("id,tenant_id,status,total,payment_method,payment_provider,payment_external_id,metadata")
      .eq("id", payment.external_reference)
      .eq("tenant_id", resolvedTenant.id)
      .maybeSingle();
    if (orderResult.error) return response({ received: false, code: "ORDER_LOOKUP_FAILED" }, 500);
    const order = orderResult.data;
    if (!order) return response({ received: true, ignored: true, reason: "order_not_found_for_verified_tenant" });

    const paymentStatus = String(payment.status || payment.order_status || "pending").toLowerCase();
    const paymentId = String(payment.id || resourceId);
    const eventId = `mercadopago:${paymentId}:${paymentStatus}:${String(payment.date_last_updated || payment.date_approved || "")}`;
    if (isMerchantOrder && !approved.has(paymentStatus)) {
      return response({ received: true, ignored: true, reason: "merchant_order_not_approved" });
    }
    const paid = approved.has(paymentStatus);
    const paymentType = String(payment.payment_type_id || "").toLowerCase();
    const isCard = ["credit_card", "debit_card", "prepaid_card"].includes(paymentType);
    const confirmationEnabled = isCard
      ? resolvedTenant.auto_confirm_card_payments !== false
      : resolvedTenant.auto_confirm_paid_orders !== false;

    // A verified provider resource still must match the order amount before any
    // payment state or order state changes.
    if (paid && money(payment.transaction_amount) !== money(order.total)) {
      console.error("[mercadopago-webhook] amount mismatch", { order_id: order.id, provider_amount: payment.transaction_amount, order_amount: order.total });
      return response({ received: false, code: "AMOUNT_MISMATCH" }, 409);
    }

    const transactionStatus = paid ? "paid" : reversed.has(paymentStatus) ? "refunded" : paymentStatus;
    const { data: existingTx, error: txLookupError } = await db.from("payment_transactions")
      .select("id")
      .eq("provider", "mercadopago")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (txLookupError) return response({ received: false, code: "PAYMENT_TRANSACTION_LOOKUP_FAILED" }, 500);
    const txValues = {
      tenant_id: order.tenant_id,
      order_id: order.id,
      provider: "mercadopago",
      method: String(payment.payment_method_id || payment.payment_type_id || "unknown"),
      status: transactionStatus,
      amount: Number(payment.transaction_amount || order.total),
      external_id: paymentId,
      external_reference: order.id,
      raw_webhook: body,
      raw_response: payment,
    };
    const txWrite = existingTx
      ? await db.from("payment_transactions").update(txValues).eq("id", existingTx.id)
      : await db.from("payment_transactions").insert(txValues);
    if (txWrite.error) return response({ received: false, code: "PAYMENT_TRANSACTION_WRITE_FAILED" }, 500);

    const update: Record<string, unknown> = {
      payment_provider: "mercadopago",
      payment_external_id: paymentId,
      payment_received: paid,
      payment_confirmed_at: paid ? new Date().toISOString() : null,
      metadata: { ...(order.metadata || {}), mercadopago_event_id: eventId, mercadopago_status: paymentStatus },
    };
    // Manual confirmation means the payment is verified but the store must
    // approve the order before it enters the operational queue.
    if (paid && order.status === "pending_payment") update.status = confirmationEnabled ? "received" : "pending_review";
    // Refund/chargeback is recorded in the transaction. Do not rewind a fulfilment
    // order automatically; that needs a separately defined dispute workflow.
    const { error: orderError } = await db.from("orders").update(update)
      .eq("id", order.id).eq("tenant_id", order.tenant_id)
      .in("status", ["pending_payment", "pending_review"]);
    if (orderError) return response({ received: false, code: "ORDER_UPDATE_FAILED" }, 500);
    // Record only after the idempotent state writes succeed. If a write fails,
    // Mercado Pago retries and this event can be processed again.
    const registered = await db.rpc("register_webhook_event", {
      _provider: "mercadopago", _event_id: eventId,
      _event_type: String(body?.type || body?.topic || body?.action || paymentStatus), _payload: body,
    });
    if (registered.error) return response({ received: false, code: "IDEMPOTENCY_REGISTRATION_FAILED" }, 500);
    if (registered.data === false) return response({ received: true, duplicate: true });
    return response({ received: true, order_id: order.id, status: update.status || order.status, payment_status: transactionStatus, confirmation: confirmationEnabled ? "automatic" : "manual" });
  } catch (error) {
    console.error("[mercadopago-webhook] unexpected error", error);
    return response({ received: false, code: "INTERNAL_ERROR" }, 500);
  }
});
