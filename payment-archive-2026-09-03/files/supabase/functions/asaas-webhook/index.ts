import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const approvedEvents = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);
const cancelledEvents = new Set(["PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_RESTORED"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
    const receivedToken = req.headers.get("asaas-access-token") || req.headers.get("x-asaas-access-token");
    if (!expectedToken) console.warn("ASAAS_WEBHOOK_TOKEN is not configured; tenant webhook tokens will be checked after resolving the order");

    const body = await req.json();
    const event = String(body?.event || body?.type || "");
    const payment = body?.payment || body?.data?.payment || body?.data || {};
    const paymentId = String(payment?.id || body?.paymentId || "");
    const externalReference = String(payment?.externalReference || payment?.external_reference || "");
    if (!event || !paymentId) return json({ received: true, ignored: true });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const eventId = String(body?.id || `${event}:${paymentId}`);
    const { data: registered, error: registerError } = await supabase.rpc("register_webhook_event", {
      _provider: "asaas",
      _event_id: eventId,
      _event_type: event,
      _payload: body,
    });
    if (registerError) throw registerError;
    if (registered === false) return json({ received: true, duplicate: true });

    let order: any = null;
    if (externalReference) {
      const byId = await supabase.from("orders").select("id,status,tenant_id,total,payment_method,customer_name,customer_phone,payment_external_id").eq("id", externalReference).maybeSingle();
      order = byId.data;
    }
    if (!order) {
      const byPayment = await supabase.from("orders").select("id,status,tenant_id,total,payment_method,customer_name,customer_phone,payment_external_id").eq("payment_external_id", paymentId).maybeSingle();
      order = byPayment.data;
    }
    if (!order) return json({ received: true, ignored: true, reason: "order_not_found" });

    const { data: tenantConfig } = await supabase.from("tenants").select("asaas_webhook_token").eq("id", order.tenant_id).maybeSingle();
    const configuredToken = expectedToken || tenantConfig?.asaas_webhook_token;
    if (configuredToken && receivedToken !== configuredToken) return json({ error: "unauthorized" }, 401);
    if (!configuredToken) console.warn("No Asaas webhook token configured globally or for tenant", order.tenant_id);

    const isApproved = approvedEvents.has(event) || String(payment?.status || "").toUpperCase() === "RECEIVED";
    const isCancelled = cancelledEvents.has(event);
    const nextStatus = isApproved ? "received" : isCancelled ? "cancelled" : order.status;
    const becameApproved = isApproved && order.status === "pending_payment";

    const { error: updateError } = await supabase.from("orders").update({
      status: nextStatus,
      payment_provider: "asaas",
      payment_external_id: paymentId,
      payment_confirmed_at: isApproved ? new Date().toISOString() : null,
      metadata: {
        ...(body?.metadata || {}),
        asaas_event: event,
        asaas_payment_status: payment?.status || null,
        asaas_payment_id: paymentId,
      },
    }).eq("id", order.id);
    if (updateError) throw updateError;

    await supabase.from("payment_transactions").update({
      status: isApproved ? "paid" : isCancelled ? "cancelled" : "pending",
      external_id: paymentId,
      raw_webhook: body,
    }).eq("provider", "asaas").eq("order_id", order.id);

    if (becameApproved) {
      await supabase.from("order_events").insert({
        order_id: order.id,
        tenant_id: order.tenant_id,
        event_type: "payment_approved",
        from_status: order.status,
        to_status: nextStatus,
        actor: "asaas",
        description: "Pagamento aprovado via Asaas",
        metadata: { asaas_event: event, payment_id: paymentId },
      });
      try {
        await supabase.functions.invoke("notify-new-order", {
          body: { orderId: order.id, tenantId: order.tenant_id, customerName: order.customer_name, total: order.total, payload: { kind: "payment_approved" } },
        });
      } catch (error) { console.error("payment approval notification failed", error); }
    }

    return json({ received: true, order_id: order.id, status: nextStatus });
  } catch (error) {
    console.error("Asaas webhook error", error);
    return json({ error: "internal_error" }, 500);
  }
});
