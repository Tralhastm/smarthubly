import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Json = Record<string, unknown>;

function reply(body: Json, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clean(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, number) * 100) / 100 : 0;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 1000) }; }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function errorFromProvider(provider: string, data: any, fallback: string) {
  const details = Array.isArray(data?.errors) ? data.errors : data?.errors || data?.message || data?.error || null;
  console.error(`[payment:${provider}] provider error`, JSON.stringify(data));
  return reply({ provider, code: "PROVIDER_ERROR", error: fallback, details }, 502);
}

function reconcileItems(items: any[], order: any) {
  const lines = (items || []).map((item: any) => ({
    title: clean(item.product_name || "Produto", 120),
    quantity: Math.max(1, Number(item.quantity) || 1),
    unit_price: money(item.product_price),
    currency_id: "BRL",
  }));
  if (money(order.delivery_fee) > 0) lines.push({ title: "Taxa de entrega", quantity: 1, unit_price: money(order.delivery_fee), currency_id: "BRL" });
  if (money(order.platform_fee) > 0) lines.push({ title: "Taxa operacional", quantity: 1, unit_price: money(order.platform_fee), currency_id: "BRL" });
  const target = money(order.total);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const cents = Math.round((target - total) * 100);
  if (cents !== 0 && lines.length) {
    const last = lines[lines.length - 1];
    last.unit_price = Math.max(0.01, Math.round((last.unit_price + cents / 100 / last.quantity) * 100) / 100);
    last.title = `${last.title} (ajuste)`;
  }
  return lines;
}

async function createAsaas(supabase: any, tenant: any, order: any, tenantId: string, orderId: string, origin: string) {
  const environment = tenant.asaas_environment === "production" ? "production" : "sandbox";
  const token = environment === "production" ? tenant.asaas_production_token : tenant.asaas_sandbox_token;
  if (tenant.asaas_enabled !== true || !token) return reply({ provider: "asaas", code: "ASAAS_NOT_CONFIGURED", error: "Asaas está selecionado, mas não há token ativo no ambiente escolhido." }, 400);

  const document = clean(order.customer_document).replace(/\D/g, "");
  if (![11, 14].includes(document.length)) return reply({ provider: "asaas", code: "CUSTOMER_DOCUMENT_REQUIRED", error: "Informe um CPF ou CNPJ válido para pagar pelo Asaas." }, 422);

  const base = environment === "production" ? "https://api.asaas.com" : "https://api-sandbox.asaas.com";
  const headers = { access_token: String(token), Accept: "application/json", "Content-Type": "application/json" };
  const customerQuery = await fetchJson(`${base}/v3/customers?cpfCnpj=${encodeURIComponent(document)}&limit=1`, { headers: { access_token: String(token), Accept: "application/json" } });
  let customer = customerQuery.data?.data?.[0];
  if (!customer?.id) {
    const customerBody: Json = { name: clean(order.customer_name || "Cliente", 100), cpfCnpj: document, externalReference: orderId };
    const email = clean(order.customer_email, 120);
    if (email) customerBody.email = email;
    const created = await fetchJson(`${base}/v3/customers`, { method: "POST", headers, body: JSON.stringify(customerBody) });
    if (!created.response.ok || !created.data?.id) return errorFromProvider("asaas", created.data, "Não foi possível criar o cliente no Asaas.");
    customer = created.data;
  }

  const paymentBody = {
    customer: customer.id,
    billingType: "UNDEFINED",
    value: money(order.total),
    dueDate: new Date().toISOString().slice(0, 10),
    description: `Pedido ${orderId}`,
    externalReference: orderId,
  };
  const createdPayment = await fetchJson(`${base}/v3/payments`, { method: "POST", headers, body: JSON.stringify(paymentBody) });
  if (!createdPayment.response.ok || !createdPayment.data?.id) return errorFromProvider("asaas", createdPayment.data, "Não foi possível criar a cobrança no Asaas.");

  let pix: any = {};
  try {
    const pixResult = await fetchJson(`${base}/v3/payments/${createdPayment.data.id}/pixQrCode`, { headers: { access_token: String(token), Accept: "application/json" } });
    if (pixResult.response.ok) pix = pixResult.data || {};
  } catch (error) { console.warn("Asaas Pix QR unavailable", error); }

  await supabase.from("orders").update({ payment_external_id: createdPayment.data.id, payment_provider: "asaas", payment_flow: "online" }).eq("id", orderId);
  await supabase.from("payment_transactions").insert({
    tenant_id: tenantId, order_id: orderId, provider: "asaas", method: "hosted_invoice", status: "pending", amount: money(order.total),
    external_id: createdPayment.data.id, external_reference: orderId, checkout_url: createdPayment.data.invoiceUrl || null,
    pix_qr_code: pix.payload || null, pix_qr_image: pix.encodedImage || null, raw_request: paymentBody,
    raw_response: { payment: createdPayment.data, pix },
  });
  return reply({ provider: "asaas", payment_id: createdPayment.data.id, status: "pending", init_point: createdPayment.data.invoiceUrl || null, pix_qr_code: pix.payload || null, pix_qr_image: pix.encodedImage || null, pix_expiration: pix.expirationDate || null });
}

async function createMercadoPago(supabase: any, tenant: any, order: any, items: any[], tenantId: string, orderId: string, origin: string) {
  const token = clean(tenant.mercadopago_token, 500);
  if (!token) return reply({ provider: "mercadopago", code: "PROVIDER_NOT_CONFIGURED", error: "Loja sem integração de pagamento configurada." }, 400);
  const storeUrl = `${origin}/loja/${clean(tenant.slug)}`;
  const body = {
    items: reconcileItems(items, order), external_reference: orderId,
    notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
    payment_methods: { installments: 12 }, statement_descriptor: clean(tenant.name || "Loja", 22),
    auto_return: "approved", back_urls: { success: `${storeUrl}/pedido/${orderId}`, failure: storeUrl, pending: `${storeUrl}/pedido/${orderId}` },
  };
  const result = await fetchJson("https://api.mercadopago.com/checkout/preferences", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!result.response.ok) return errorFromProvider("mercadopago", result.data, "Não foi possível criar o checkout no Mercado Pago.");
  const initPoint = token.startsWith("TEST-") ? result.data.sandbox_init_point : result.data.init_point;
  if (!initPoint) return reply({ provider: "mercadopago", code: "CHECKOUT_URL_MISSING", error: "O Mercado Pago não retornou a URL de checkout." }, 502);
  await supabase.from("orders").update({ payment_external_id: result.data.id, payment_provider: "mercadopago", payment_flow: "online" }).eq("id", orderId);
  await supabase.from("payment_transactions").insert({ tenant_id: tenantId, order_id: orderId, provider: "mercadopago", method: "checkout_link", status: "pending", amount: money(order.total), external_id: result.data.id, external_reference: orderId, checkout_url: initPoint, raw_request: body, raw_response: result.data });
  return reply({ provider: "mercadopago", payment_id: result.data.id, status: "pending", init_point: initPoint });
}

async function createPagBank(supabase: any, tenant: any, order: any, items: any[], tenantId: string, orderId: string, origin: string) {
  const token = clean(tenant.pagbank_token, 500);
  if (!token) return reply({ provider: "pagbank", code: "PROVIDER_NOT_CONFIGURED", error: "Loja sem token PagBank configurado." }, 400);
  const base = tenant.pagbank_env === "production" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";
  const body = { reference_id: orderId, items: reconcileItems(items, order).map((x: any) => ({ reference_id: x.title.slice(0, 64), name: x.title, quantity: x.quantity, unit_amount: Math.round(x.unit_price * 100) })), payment_methods: [{ type: "PIX" }, { type: "CREDIT_CARD" }, { type: "DEBIT_CARD" }, { type: "BOLETO" }], redirect_url: `${origin}/loja/${clean(tenant.slug)}/pedido/${orderId}`, return_url: `${origin}/loja/${clean(tenant.slug)}/pedido/${orderId}`, notification_urls: [`${Deno.env.get("SUPABASE_URL")}/functions/v1/pagbank-webhook`] };
  const result = await fetchJson(`${base}/checkouts`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "x-api-version": "4.0" }, body: JSON.stringify(body) });
  if (!result.response.ok) return errorFromProvider("pagbank", result.data, "Não foi possível criar o checkout no PagBank.");
  const link = result.data?.links?.find((item: any) => String(item.rel).toUpperCase() === "PAY")?.href || result.data?.links?.[0]?.href;
  if (!link) return reply({ provider: "pagbank", code: "CHECKOUT_URL_MISSING", error: "O PagBank não retornou a URL de checkout." }, 502);
  await supabase.from("orders").update({ payment_external_id: result.data.id, payment_provider: "pagbank", payment_flow: "online" }).eq("id", orderId);
  await supabase.from("payment_transactions").insert({ tenant_id: tenantId, order_id: orderId, provider: "pagbank", method: "checkout_link", status: "pending", amount: money(order.total), external_id: result.data.id, external_reference: orderId, checkout_url: link, raw_request: body, raw_response: result.data });
  return reply({ provider: "pagbank", payment_id: result.data.id, status: "pending", init_point: link });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return reply({ code: "METHOD_NOT_ALLOWED", error: "Método não permitido." }, 405);
  try {
    const body = await req.json();
    const orderId = clean(body?.order_id, 80);
    const tenantId = clean(body?.tenant_id, 80);
    if (!orderId || !tenantId) return reply({ code: "INVALID_REQUEST", error: "order_id e tenant_id são obrigatórios." }, 400);
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return reply({ code: "SERVER_MISCONFIGURED", error: "Servidor de pagamentos sem configuração interna." }, 500);
    const supabase = createClient(url, serviceKey);
    const [tenantResult, orderResult, itemsResult] = await Promise.all([
      supabase.from("tenants").select("id,slug,name,payment_provider,mercadopago_token,pagbank_token,pagbank_env,asaas_enabled,asaas_environment,asaas_sandbox_token,asaas_production_token").eq("id", tenantId).maybeSingle(),
      supabase.from("orders").select("*").eq("id", orderId).eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("order_items").select("*").eq("order_id", orderId),
    ]);
    if (tenantResult.error || !tenantResult.data) return reply({ code: "TENANT_NOT_FOUND", error: "Loja não encontrada." }, 404);
    if (orderResult.error || !orderResult.data) return reply({ code: "ORDER_NOT_FOUND", error: "Pedido não encontrado." }, 404);
    const tenant = tenantResult.data as any;
    const order = orderResult.data as any;
    const provider = clean(tenant.payment_provider || "mercadopago").toLowerCase();
    const origin = req.headers.get("origin") || "https://smarthubly.pages.dev";
    console.log(`[payment] order=${orderId} provider=${provider} total=${money(order.total)}`);
    if (provider === "asaas") return await createAsaas(supabase, tenant, order, tenantId, orderId, origin);
    if (provider === "pagbank") return await createPagBank(supabase, tenant, order, itemsResult.data || [], tenantId, orderId, origin);
    return await createMercadoPago(supabase, tenant, order, itemsResult.data || [], tenantId, orderId, origin);
  } catch (error) {
    console.error("[payment] unexpected error", error);
    return reply({ code: "INTERNAL_ERROR", error: "Erro interno ao processar o pagamento." }, 500);
  }
});
