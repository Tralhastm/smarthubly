import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PENDING_PAYMENT_STATUS = "pending_payment";

const isPaymentNotification = (body: any) => {
  return body?.type === "payment" || body?.action === "payment.updated" || body?.action === "payment.created";
};

const isMerchantOrderNotification = (body: any) => {
  return body?.topic === "merchant_order" || String(body?.resource || "").includes("/merchant_orders/");
};

const mapPaymentStatusToOrderStatus = (paymentStatus?: string | null) => {
  switch (paymentStatus) {
    case "approved":
      return "received";
    case "rejected":
    case "cancelled":
    case "refunded":
    case "charged_back":
      return "cancelled";
    case "pending":
    case "in_process":
    case "authorized":
    default:
      return PENDING_PAYMENT_STATUS;
  }
};

// Sempre grava o rótulo canônico "mercadopago" (independente da modalidade interna do MP).
// O detalhe (pix/cartão) fica no histórico do MP — aqui o relatório fica limpo.
const formatPaymentMethod = (_paymentTypeId?: string | null) => 'mercadopago';

const fetchMercadoPagoResource = async (url: string, accessToken: string) => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Mercado Pago resource not found: ${url}`);
  }

  return response.json();
};

const resolvePaymentNotification = async (body: any, accessToken: string) => {
  const paymentId = body?.data?.id;
  if (!paymentId) return null;

  const paymentData = await fetchMercadoPagoResource(`https://api.mercadopago.com/v1/payments/${paymentId}`, accessToken);

  if (!paymentData?.external_reference) {
    return null;
  }

  return {
    orderId: paymentData.external_reference,
    paymentStatus: paymentData.status,
    paymentTypeId: paymentData.payment_type_id ?? null,
  };
};

const resolveMerchantOrderNotification = async (body: any, accessToken: string) => {
  const resource = body?.resource;
  if (typeof resource !== "string" || !resource) return null;

  const merchantOrder = await fetchMercadoPagoResource(resource, accessToken);
  if (!merchantOrder?.external_reference) {
    return null;
  }

  const payments = Array.isArray(merchantOrder.payments) ? merchantOrder.payments : [];
  const selectedPayment = payments.find((payment: any) => payment.status === "approved") ?? payments[payments.length - 1] ?? null;

  let paymentStatus = selectedPayment?.status ?? null;
  let paymentTypeId = selectedPayment?.payment_type_id ?? null;

  if (selectedPayment?.id && (!paymentStatus || !paymentTypeId)) {
    try {
      const paymentData = await fetchMercadoPagoResource(`https://api.mercadopago.com/v1/payments/${selectedPayment.id}`, accessToken);
      paymentStatus = paymentData?.status ?? paymentStatus;
      paymentTypeId = paymentData?.payment_type_id ?? paymentTypeId;
    } catch (error) {
      console.error("Could not hydrate merchant_order payment:", error);
    }
  }

  if (!paymentStatus) {
    const merchantOrderStatus = merchantOrder.order_status ?? merchantOrder.status;
    paymentStatus = merchantOrderStatus === "closed" ? "approved" : merchantOrderStatus === "cancelled" ? "cancelled" : "pending";
  }

  return {
    orderId: merchantOrder.external_reference,
    paymentStatus,
    paymentTypeId,
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Webhook received:", JSON.stringify(body));

    if (!isPaymentNotification(body) && !isMerchantOrderNotification(body)) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const idempSupabase = createClient(supabaseUrl, supabaseKey);

    // 🛡️ Idempotência: chave estável por evento. Tipos diferentes (payment vs merchant_order)
    // referenciando o mesmo recurso geram event_ids distintos — desejado.
    const eventId =
      body?.id?.toString() ||
      (body?.type === "payment" && body?.data?.id ? `payment:${body.data.id}:${body?.action ?? ""}` : null) ||
      (isMerchantOrderNotification(body) && body?.resource ? `merchant_order:${body.resource}` : null) ||
      `unknown:${crypto.randomUUID()}`;

    const { data: dedup } = await idempSupabase.rpc("register_webhook_event", {
      _provider: "mercadopago",
      _event_id: String(eventId),
      _event_type: body?.type || body?.topic || body?.action || null,
      _payload: body,
    });

    if (dedup === false) {
      console.log(`Duplicate webhook ignored: mercadopago/${eventId}`);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, mercadopago_token")
      .not("mercadopago_token", "is", null);

    let notificationData: { orderId: string; paymentStatus: string | null; paymentTypeId: string | null } | null = null;

    for (const tenant of tenants || []) {
      if (!tenant.mercadopago_token) continue;

      try {
        notificationData = isMerchantOrderNotification(body)
          ? await resolveMerchantOrderNotification(body, tenant.mercadopago_token)
          : await resolvePaymentNotification(body, tenant.mercadopago_token);

        if (notificationData?.orderId) {
          break;
        }
      } catch (error) {
        console.error("Error resolving notification for tenant", tenant.id, error);
      }
    }

    if (!notificationData?.orderId) {
      console.error("Notification could not be resolved for any tenant");
      return new Response(JSON.stringify({ error: "Payment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, tenant_id, total, delivery_type, customer_address, payment_method, customer_name, customer_phone")
      .eq("id", notificationData.orderId)
      .single();

    if (orderError || !order) {
      console.error("Order not found:", notificationData.orderId, orderError);
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carrega flags de automação do tenant
    const { data: tenant } = await supabase
      .from("tenants")
      .select("auto_confirm_paid_orders, auto_confirm_card_payments, name")
      .eq("id", order.tenant_id)
      .single();

    let orderStatus = mapPaymentStatusToOrderStatus(notificationData.paymentStatus);
    const paymentMethod = formatPaymentMethod(notificationData.paymentTypeId);
    const previousStatus = order.status;
    const isCard = (notificationData.paymentTypeId || "").includes("card");

    // 🤖 Auto-confirmação: se habilitado, pula direto received → preparing
    const autoConfirmAllowed = tenant?.auto_confirm_paid_orders &&
      (isCard ? tenant?.auto_confirm_card_payments !== false : true);
    if (orderStatus === "received" && previousStatus === PENDING_PAYMENT_STATUS && autoConfirmAllowed) {
      orderStatus = "preparing";
    }

    if (order.status !== orderStatus || paymentMethod !== order.payment_method) {
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: orderStatus,
          payment_method: paymentMethod,
        })
        .eq("id", notificationData.orderId);

      if (updateError) {
        console.error("Error updating order:", updateError);
      }
    }

    // Quando o pagamento é APROVADO pela primeira vez (estava pending_payment
    // → vai pra received): cria a entrada financeira e decrementa o estoque.
    // Idempotente: só roda se a transição é de pending_payment -> received.
    const becameApproved =
      orderStatus === "received" && previousStatus === PENDING_PAYMENT_STATUS;

    if (becameApproved) {
      // 1) Decrementa estoque (o pedido só "consome" estoque quando pago)
      try {
        const { data: items } = await supabase
          .from("order_items")
          .select("product_name, quantity")
          .eq("order_id", order.id);

        if (items && items.length > 0) {
          // Busca produtos pelo nome (no insert os nomes são exatos)
          const names = Array.from(new Set(items.map((i: any) => i.product_name)));
          const { data: products } = await supabase
            .from("products")
            .select("id, name, stock_quantity, in_stock")
            .eq("tenant_id", order.tenant_id)
            .in("name", names);

          const totalsByProduct = new Map<string, number>();
          for (const it of items as any[]) {
            const p = (products || []).find((x: any) => x.name === it.product_name);
            if (!p) continue;
            totalsByProduct.set(p.id, (totalsByProduct.get(p.id) || 0) + Number(it.quantity || 0));
          }

          for (const [productId, qty] of totalsByProduct.entries()) {
            const p = (products || []).find((x: any) => x.id === productId);
            if (!p || p.stock_quantity == null) continue;
            const newQty = Math.max(0, Number(p.stock_quantity) - qty);
            await supabase.from("products").update({
              stock_quantity: newQty,
              in_stock: newQty > 0 ? p.in_stock : false,
            }).eq("id", productId);
          }
        }
      } catch (e) {
        console.error("stock decrement failed:", e);
      }

      // 2) Cria entrada financeira (idempotente via marcador na descrição)
      try {
        const marker = `#ORDER_REVENUE:${order.id}`;
        const { data: existing } = await supabase
          .from("financial_entries")
          .select("id")
          .eq("tenant_id", order.tenant_id)
          .ilike("description", `%${marker}%`)
          .limit(1);

        if (!existing || existing.length === 0) {
          const totalNum = Number(order.total) || 0;
          if (totalNum > 0) {
            const shortId = order.id.slice(0, 8).toUpperCase();
            await supabase.from("financial_entries").insert({
              tenant_id: order.tenant_id,
              type: "income",
              category: "venda_online",
              description: `Venda online #${shortId} (${paymentMethod}) ${marker}`,
              amount: totalNum,
              date: new Date().toISOString(),
            });
          }
        }
      } catch (e) {
        console.error("financial entry creation failed:", e);
      }
    }

    // 🔔 Quando pagamento aprovado: registra evento + dispara push pra cozinha
    if (becameApproved) {
      try {
        await supabase.from("order_events").insert({
          order_id: order.id,
          tenant_id: order.tenant_id,
          event_type: "payment_approved",
          from_status: previousStatus,
          to_status: orderStatus,
          actor: "mercadopago",
          description: `Pagamento aprovado via ${paymentMethod}` + (orderStatus === "preparing" ? " — auto-iniciado" : ""),
          metadata: { payment_type: notificationData.paymentTypeId },
        });
      } catch (e) { console.error("event log failed", e); }

      try {
        await supabase.functions.invoke("notify-new-order", {
          body: {
            orderId: order.id,
            tenantId: order.tenant_id,
            customerName: order.customer_name,
            total: order.total,
            payload: { kind: "payment_approved", autoStarted: orderStatus === "preparing" },
          },
        });
      } catch (e) { console.error("push notify failed", e); }
    }

    console.log(`Order ${notificationData.orderId} updated to ${orderStatus} (was ${previousStatus})`);

    return new Response(JSON.stringify({ received: true, order_id: notificationData.orderId, status: orderStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
