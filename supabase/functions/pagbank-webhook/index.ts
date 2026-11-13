import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const approved = new Set(["PAID", "AUTHORIZED", "AVAILABLE"]);
const reversed = new Set(["CANCELED", "CANCELLED", "DECLINED", "REFUNDED", "CHARGEBACK"]);
const moneyCents = (value: unknown) => Math.round(Number(value || 0) * 100);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ received: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await request.json();
    const reference = String(body?.reference_id || body?.metadata?.order_id || "");
    const callbackId = String(body?.id || body?.order_id || "");
    if (!reference && !callbackId) return json({ received: true, ignored: true });

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ received: false, code: "SERVER_MISCONFIGURED" }, 500);
    const db = createClient(url, key);

    let orderQuery = db.from("orders").select("id,tenant_id,status,total,payment_method,payment_provider,payment_external_id,metadata");
    if (reference) orderQuery = orderQuery.eq("id", reference);
    else orderQuery = orderQuery.eq("payment_external_id", callbackId);
    const { data: order, error: orderLookupError } = await orderQuery.maybeSingle();
    if (orderLookupError) return json({ received: false, code: "ORDER_LOOKUP_FAILED" }, 500);
    if (!order) return json({ received: true, ignored: true, reason: "order_not_found" });

    const { data: tenant, error: tenantError } = await db.from("tenants")
      .select("pagbank_token,pagbank_env,auto_confirm_paid_orders,auto_confirm_card_payments")
      .eq("id", order.tenant_id).maybeSingle();
    if (tenantError) return json({ received: false, code: "TENANT_LOOKUP_FAILED" }, 500);
    if (!tenant?.pagbank_token || !order.payment_external_id) {
      return json({ received: false, code: "PAGBANK_ORDER_NOT_CONFIGURED" }, 409);
    }

    // Callback body is untrusted. Fetch the canonical order using the store's
    // PagBank bearer token and only use the provider response for status/amount.
    const base = tenant.pagbank_env === "production" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";
    const providerResponse = await fetch(`${base}/checkouts/${encodeURIComponent(order.payment_external_id)}`, {
      headers: { Authorization: `Bearer ${tenant.pagbank_token}`, Accept: "application/json", "x-api-version": "4.0" },
    });
    if (!providerResponse.ok) {
      console.error("[pagbank-webhook] provider verification failed", { order_id: order.id, http_status: providerResponse.status });
      return json({ received: false, code: "PROVIDER_VERIFICATION_FAILED" }, 502);
    }
    const canonical = await providerResponse.json();
    if (String(canonical?.reference_id || "") !== String(order.id)) {
      console.error("[pagbank-webhook] reference mismatch", { order_id: order.id });
      return json({ received: false, code: "REFERENCE_MISMATCH" }, 409);
    }
    const charge = (canonical?.charges || []).find((c: any) => !c?.id || !body?.charges?.[0]?.id || String(c.id) === String(body.charges[0].id))
      || canonical?.charges?.[0];
    if (!charge) return json({ received: true, ignored: true, reason: "charge_not_found" });

    const status = String(charge.status || canonical.status || "WAITING").toUpperCase();
    const paid = approved.has(status);
    const amountInCents = Number(charge?.amount?.value ?? canonical?.items?.reduce((s: number, i: any) => s + Number(i.unit_amount || 0) * Number(i.quantity || 1), 0));
    if (paid && amountInCents !== moneyCents(order.total)) {
      console.error("[pagbank-webhook] amount mismatch", { order_id: order.id, provider_cents: amountInCents, order_cents: moneyCents(order.total) });
      return json({ received: false, code: "AMOUNT_MISMATCH" }, 409);
    }

    const eventId = `pagbank:${String(charge.id || canonical.id)}:${status}:${String(charge.paid_at || charge.updated_at || canonical.updated_at || "")}`;
    const paymentMethod = String(charge?.payment_method?.type || charge?.payment_method?.method || "").toUpperCase();
    const isCard = paymentMethod.includes("CREDIT") || paymentMethod.includes("DEBIT") || paymentMethod.includes("CARD");
    const confirmationEnabled = isCard
      ? tenant.auto_confirm_card_payments !== false
      : tenant.auto_confirm_paid_orders !== false;
    const txStatus = paid ? "paid" : reversed.has(status) ? (status.includes("REFUND") || status.includes("CHARGEBACK") ? "refunded" : "cancelled") : status.toLowerCase();

    const { data: existingTx, error: txLookupError } = await db.from("payment_transactions")
      .select("id")
      .eq("provider", "pagbank")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (txLookupError) return json({ received: false, code: "PAYMENT_TRANSACTION_LOOKUP_FAILED" }, 500);
    const txValues = {
      tenant_id: order.tenant_id,
      order_id: order.id,
      provider: "pagbank",
      method: paymentMethod || "unknown",
      status: txStatus,
      amount: Number(order.total),
      external_id: String(charge.id || order.payment_external_id),
      external_reference: order.id,
      raw_webhook: body,
      raw_response: canonical,
    };
    const txWrite = existingTx
      ? await db.from("payment_transactions").update(txValues).eq("id", existingTx.id)
      : await db.from("payment_transactions").insert(txValues);
    if (txWrite.error) return json({ received: false, code: "PAYMENT_TRANSACTION_WRITE_FAILED" }, 500);

    const orderUpdate: Record<string, unknown> = {
      payment_provider: "pagbank",
      payment_received: paid,
      payment_confirmed_at: paid ? new Date().toISOString() : null,
      metadata: { ...(order.metadata || {}), pagbank_event_id: eventId, pagbank_status: status },
    };
    if (paid && order.status === "pending_payment") orderUpdate.status = confirmationEnabled ? "received" : "pending_review";
    // Reversals are persisted to payment_transactions but do not rewind a fulfilled order.
    const { error: updateError } = await db.from("orders").update(orderUpdate)
      .eq("id", order.id).eq("tenant_id", order.tenant_id)
      .in("status", ["pending_payment", "pending_review"]);
    if (updateError) return json({ received: false, code: "ORDER_UPDATE_FAILED" }, 500);

    const registered = await db.rpc("register_webhook_event", { _provider: "pagbank", _event_id: eventId, _event_type: status, _payload: body });
    if (registered.error) return json({ received: false, code: "IDEMPOTENCY_REGISTRATION_FAILED" }, 500);
    if (registered.data === false) return json({ received: true, duplicate: true });

    return json({ received: true, order_id: order.id, status: orderUpdate.status || order.status, payment_status: txStatus, confirmation: confirmationEnabled ? "automatic" : "manual" });
  } catch (error) {
    console.error("[pagbank-webhook] unexpected error", error);
    return json({ received: false, code: "INTERNAL_ERROR" }, 500);
  }
});
