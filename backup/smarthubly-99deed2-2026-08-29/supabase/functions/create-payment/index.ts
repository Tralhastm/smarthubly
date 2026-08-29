import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { order_id, tenant_id } = await req.json();

    if (!order_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "order_id e tenant_id são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t0 = Date.now();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch tenant, order and items in parallel
    const [tenantRes, orderRes, itemsRes] = await Promise.all([
      supabase.from("tenants").select("mercadopago_token, name, slug, payment_provider, pagbank_token, pagbank_env").eq("id", tenant_id).single(),
      supabase.from("orders").select("*").eq("id", order_id).single(),
      supabase.from("order_items").select("*").eq("order_id", order_id),
    ]);
    console.log(`DB fetch: ${Date.now() - t0}ms`);

    const tenant: any = tenantRes.data;
    const order = orderRes.data;
    const items = itemsRes.data;

    if (tenantRes.error || !tenant) {
      return new Response(JSON.stringify({ error: "Loja não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderRes.error || !order) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provider = tenant.payment_provider || "mercadopago";
    const originHeader = req.headers.get("origin") || "https://snuggle-puff-joy.lovable.app";
    const storeUrlEarly = `${originHeader}/loja/${tenant.slug}`;

    // ============ PAGBANK ROUTE ============
    if (provider === "pagbank") {
      const pbToken: string | null = tenant.pagbank_token;
      const pbEnv: string = tenant.pagbank_env || "sandbox";
      if (!pbToken) {
        return new Response(JSON.stringify({ error: "Loja sem token PagBank configurado" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const pbBase = pbEnv === "production" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";
      const webhookUrl = `${supabaseUrl}/functions/v1/pagbank-webhook`;

      const pbItems: any[] = (items || []).map((it: any) => ({
        reference_id: String(it.id || it.product_id || "item").slice(0, 64),
        name: String(it.product_name || "Item").slice(0, 100),
        quantity: Number(it.quantity) || 1,
        unit_amount: Math.round(Number(it.product_price) * 100),
      }));
      const deliveryCents = Math.round(Number(order.delivery_fee || 0) * 100);
      const feeCents = Math.round(Number((order as any).platform_fee || 0) * 100);
      if (deliveryCents > 0) pbItems.push({ reference_id: "delivery", name: "Taxa de entrega", quantity: 1, unit_amount: deliveryCents });
      if (feeCents > 0) pbItems.push({ reference_id: "platform-fee", name: "Taxa operacional", quantity: 1, unit_amount: feeCents });
      const desiredTotalCents = Math.round(Number(order.total) * 100);
      const sum = pbItems.reduce((s, it) => s + it.unit_amount * it.quantity, 0);
      const diff = sum - desiredTotalCents;
      if (diff !== 0 && pbItems.length > 0) {
        const last = pbItems[pbItems.length - 1];
        last.unit_amount = Math.max(1, last.unit_amount - Math.round(diff / last.quantity));
        last.name = `${last.name} (ajuste)`;
      }

      const customer: any = {};
      if (order.customer_name) customer.name = String(order.customer_name).slice(0, 60);
      if ((order as any).customer_email) customer.email = String((order as any).customer_email).slice(0, 60);

      const checkoutBody: any = {
        reference_id: order_id,
        customer: customer.email ? customer : undefined,
        items: pbItems,
        payment_methods: [
          { type: "PIX" },
          { type: "CREDIT_CARD" },
          { type: "DEBIT_CARD" },
          { type: "BOLETO" },
        ],
        redirect_url: `${storeUrlEarly}/meus-pedidos`,
        return_url: `${storeUrlEarly}/meus-pedidos`,
        notification_urls: [webhookUrl],
        soft_descriptor: String(tenant.name || "Loja").slice(0, 17),
      };

      const tPb = Date.now();
      const ctrl = new AbortController();
      const tId = setTimeout(() => ctrl.abort(), 12000);
      const pbRes = await fetch(`${pbBase}/checkouts`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${pbToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "x-api-version": "4.0",
        },
        body: JSON.stringify(checkoutBody),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(tId));
      console.log(`PagBank API: ${Date.now() - tPb}ms`);

      const pbData = await pbRes.json().catch(() => ({}));
      if (!pbRes.ok) {
        console.error("PagBank error:", JSON.stringify(pbData));
        return new Response(JSON.stringify({ error: "Erro ao criar pagamento no PagBank", details: pbData }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payLink = (pbData?.links || []).find((l: any) => String(l.rel).toUpperCase() === "PAY")?.href
        || (pbData?.links || [])[0]?.href;
      if (!payLink) {
        return new Response(JSON.stringify({ error: "PagBank não retornou link de pagamento", details: pbData }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("payment_transactions").insert({
        tenant_id, order_id, provider: "pagbank", method: "checkout_link",
        status: "pending", amount: Number(order.total),
        external_id: pbData?.id || null, external_reference: order_id,
        checkout_url: payLink, raw_request: checkoutBody, raw_response: pbData,
      });

      return new Response(JSON.stringify({
        init_point: payLink, provider: "pagbank", preference_id: pbData?.id || null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // ============ /PAGBANK ROUTE ============

    if (!tenant.mercadopago_token) {
      return new Response(JSON.stringify({ error: "Loja sem integração de pagamento configurada" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SOURCE OF TRUTH: order.total (DB) — already includes everything (subtotal + delivery + customer-visible fee − coupon discount)
    // We send line items for the customer to see breakdown, then add a "Desconto" line if needed so the MP sum matches order.total exactly.
    const mpItems = (items || []).map((item: any) => ({
      title: item.product_name,
      quantity: item.quantity,
      unit_price: Number(item.product_price),
      currency_id: "BRL",
    }));

    if (Number(order.delivery_fee) > 0) {
      mpItems.push({
        title: "Taxa de entrega",
        quantity: 1,
        unit_price: Number(order.delivery_fee),
        currency_id: "BRL",
      });
    }

    if (Number(order.platform_fee) > 0) {
      mpItems.push({
        title: "Taxa operacional",
        quantity: 1,
        unit_price: Number(order.platform_fee),
        currency_id: "BRL",
      });
    }

    // Reconcile: ensure MP charges exactly order.total
    const mpSum = mpItems.reduce((s: number, it: any) => s + it.unit_price * it.quantity, 0);
    const orderTotal = Number(order.total);
    const diff = Math.round((mpSum - orderTotal) * 100) / 100;
    if (diff > 0.01) {
      // MP sum is higher than order total → add a discount line (negative not allowed in items, so reduce platform fee or use a discount entry)
      // Strategy: subtract diff from the largest line item's unit_price proportionally is complex; simplest = adjust last line.
      const last = mpItems[mpItems.length - 1];
      const newUnit = Math.max(0.01, Number((last.unit_price - diff / last.quantity).toFixed(2)));
      last.unit_price = newUnit;
      last.title = `${last.title} (com desconto cupom)`;
    } else if (diff < -0.01) {
      // MP sum is lower than order total → add an adjustment line
      mpItems.push({
        title: "Ajuste",
        quantity: 1,
        unit_price: Math.abs(diff),
        currency_id: "BRL",
      });
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/mercadopago-webhook`;
    const origin = req.headers.get("origin") || "https://snuggle-puff-joy.lovable.app";
    const storeUrl = `${origin}/loja/${tenant.slug}`;

    const preferenceBody = {
      items: mpItems,
      external_reference: order_id,
      notification_url: webhookUrl,
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 12,
      },
      statement_descriptor: tenant.name.substring(0, 22),
      auto_return: "approved",
      back_urls: {
        success: `${storeUrl}/meus-pedidos`,
        failure: storeUrl,
        pending: `${storeUrl}/meus-pedidos`,
      },
    };

    // Create preference via Mercado Pago API (with timeout)
    const tMp = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tenant.mercadopago_token}`,
      },
      body: JSON.stringify(preferenceBody),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    console.log(`MP API: ${Date.now() - tMp}ms`);

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Mercado Pago error:", JSON.stringify(mpData));
      return new Response(JSON.stringify({ error: "Erro ao criar pagamento no Mercado Pago", details: mpData }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TEST- prefix = sandbox token, APP_USR- prefix = production token
    const isTestToken = tenant.mercadopago_token.startsWith('TEST-');
    let checkoutUrl: string = isTestToken ? mpData.sandbox_init_point : mpData.init_point;

    // 🌐 Força a VERSÃO WEB do Mercado Pago (evita App Link no Android):
    // - Remove redirect_from_app
    // - Marca source/platform/mode = web
    // - Troca domínios mobile (mpago.la / m.mercadopago) por www.mercadopago.com.br
    try {
      const u = new URL(checkoutUrl);
      u.searchParams.delete("redirect_from_app");
      u.searchParams.set("source", "web");
      u.searchParams.set("platform", "web");
      u.searchParams.set("mode", "web");
      if (u.hostname === "mpago.la" || u.hostname === "mpago.li" || u.hostname.startsWith("m.mercadopago")) {
        u.hostname = "www.mercadopago.com.br";
      }
      checkoutUrl = u.toString();
    } catch { /* mantém url original em caso de parse error */ }

    return new Response(JSON.stringify({
      init_point: checkoutUrl,
      sandbox_init_point: mpData.sandbox_init_point,
      preference_id: mpData.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Erro interno ao processar pagamento" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
