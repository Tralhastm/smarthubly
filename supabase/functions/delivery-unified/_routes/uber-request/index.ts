// Edge function: cria entrega via Uber Direct para um pedido
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getUberToken, uberApiHost } from "../../../_shared/uber-direct.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toBRPhone(raw: string): string {
  if (!raw) return "";
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return "";
  return `+55${d}`;
}

export async function uber_request(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), { status: 400, headers: corsHeaders });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
    if (!order) throw new Error("Pedido não encontrado");
    const { data: tenant } = await supabase.from("tenants").select("*").eq("id", order.tenant_id).single();
    if (!tenant) throw new Error("Loja não encontrada");
    // Se o super-admin ativou DEMO, força chaves globais sandbox mesmo se a loja tiver chaves próprias salvas.
    const _usePlatform = !!tenant.uber_direct_use_platform_keys;
    const _hasOwnKeys = !_usePlatform && !!(tenant.uber_direct_customer_id && tenant.uber_direct_client_id && tenant.uber_direct_client_secret);
    const _customerId = _usePlatform ? Deno.env.get("UBER_CUSTOMER_ID") || "" : (_hasOwnKeys ? tenant.uber_direct_customer_id : "");
    const _clientId = _usePlatform ? Deno.env.get("UBER_CLIENT_ID") || "" : (_hasOwnKeys ? tenant.uber_direct_client_id : "");
    const _clientSecret = _usePlatform ? Deno.env.get("UBER_CLIENT_SECRET") || "" : (_hasOwnKeys ? tenant.uber_direct_client_secret : "");
    const _sandbox = _usePlatform ? true : !!tenant.uber_direct_sandbox;
    if (!_customerId || !_clientId || !_clientSecret) {
      throw new Error("Uber Direct não configurado nesta loja");
    }

    const pickupAddr = tenant.shipping_origin_address || tenant.address;
    const dropoffAddr = order.customer_address;
    if (!pickupAddr || !dropoffAddr) throw new Error("Endereço de origem ou destino vazio");

    const senderPhone = toBRPhone(tenant.phone || tenant.whatsapp || "");
    const recipientPhone = toBRPhone(order.customer_phone || "");
    if (!senderPhone) throw new Error("Telefone do remetente inválido");
    if (!recipientPhone) throw new Error(`Telefone do cliente inválido: "${order.customer_phone}"`);

    const creds = {
      customerId: _customerId,
      clientId: _clientId,
      clientSecret: _clientSecret,
      sandbox: _sandbox,
    };
    const token = await getUberToken(creds);

    const payload = {
      pickup_name: tenant.name,
      pickup_address: JSON.stringify({ street_address: [pickupAddr], country: "BR" }),
      pickup_phone_number: senderPhone,
      dropoff_name: order.customer_name || "Cliente",
      dropoff_address: JSON.stringify({ street_address: [dropoffAddr], country: "BR" }),
      dropoff_phone_number: recipientPhone,
      manifest_items: [{
        name: `Pedido #${String(order.id).slice(0, 6)}`,
        quantity: 1,
        size: "small",
      }],
    };

    const url = `${uberApiHost(creds.sandbox)}/v1/customers/${creds.customerId}/deliveries`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Uber Direct: ${data?.message || data?.code || JSON.stringify(data)}`);

    const deliveryId = data?.id;
    const trackingUrl = data?.tracking_url;
    const fee = Number(data?.fee) / 100;

    await supabase.from("orders").update({
      uber_direct_delivery_id: deliveryId,
      uber_direct_status: data?.status || "pending",
      uber_direct_tracking_url: trackingUrl,
      uber_direct_price: Number.isFinite(fee) ? fee : null,
      delivery_provider: "uber_direct",
    } as any).eq("id", orderId);

    await supabase.from("order_events").insert({
      order_id: orderId,
      tenant_id: order.tenant_id,
      event_type: "uber_direct_dispatched",
      to_status: "out-for-delivery",
      actor: "system",
      description: `Uber Direct acionada — preço R$${fee.toFixed(2)}, tracking: ${trackingUrl || "n/a"}`,
      metadata: { uber_direct_delivery_id: deliveryId, tracking_url: trackingUrl, price: fee },
    } as any);

    return new Response(JSON.stringify({ success: true, deliveryId, trackingUrl, price: fee }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Uber Direct error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  } catch (e) {
    console.error("[unified:uber-request] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
