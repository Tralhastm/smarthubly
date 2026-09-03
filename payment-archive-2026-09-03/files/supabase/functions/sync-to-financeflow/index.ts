import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SyncEvent =
  | "order_delivered"
  | "order_cancelled"
  | "product_upsert"
  | "product_delete"
  | "stock_change"
  | "full_catalog";

interface SyncPayload {
  tenantId: string;
  event: SyncEvent;
  data: any;
}

// Normaliza URL: aceita raiz do projeto OU URL completa colada por engano
function buildEndpoint(url: string): string {
  let cleanUrl = url.trim().replace(/\/+$/, "");
  cleanUrl = cleanUrl.replace(/\/functions\/v1\/inbox-from-store\/?$/i, "");
  return `${cleanUrl}/functions/v1/inbox-from-store`;
}

// POST único com retry exponencial leve (3 tentativas) — pra não perder evento por blip de rede
async function postOnce(endpoint: string, apiKey: string, body: any) {
  const maxAttempts = 3;
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Store-Api-Key": apiKey,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      // 4xx é problema de contrato/credencial — não adianta retry
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, body: parsed, attempts: attempt };
      }
      if (res.ok) return { ok: true, status: res.status, body: parsed, attempts: attempt };
      lastErr = { status: res.status, body: parsed };
    } catch (e) {
      lastErr = { error: e instanceof Error ? e.message : String(e) };
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }
  return { ok: false, status: 0, body: lastErr, attempts: maxAttempts };
}

// === Mapeadores: traduzem nossas linhas brutas pro contrato do FinanceFlow ===

function mapOrderToFF(o: any) {
  return {
    external_id: String(o.id),
    total: Number(o.total ?? 0),
    delivery_fee: Number(o.delivery_fee ?? 0),
    payment_method: o.payment_method ?? null,
    sale_date: o.updated_at ?? o.created_at ?? new Date().toISOString(),
    notes: [
      o.customer_name ? `Cliente: ${o.customer_name}` : null,
      o.customer_phone ? `Tel: ${o.customer_phone}` : null,
      o.coupon_code ? `Cupom: ${o.coupon_code}` : null,
      o.discount_amount ? `Desconto: ${o.discount_amount}` : null,
    ].filter(Boolean).join(" | "),
  };
}

function mapCancelToFF(o: any) {
  return {
    external_id: String(o.id),
    cancelled_at: o.updated_at ?? new Date().toISOString(),
    reason: o.cancel_reason ?? "cancelled_by_store",
    // total opcional — ajuda o FinanceFlow conferir o estorno
    total: Number(o.total ?? 0),
    payment_method: o.payment_method ?? null,
  };
}

function mapProductToFF(p: any) {
  return {
    external_id: String(p.id),
    name: p.name ?? "",
    description: p.description ?? null,
    category: p.category ?? null,
    cost_price: p.original_price != null ? Number(p.original_price) : null,
    sale_price: Number(p.price ?? 0),
    stock_quantity: Number(p.stock_quantity ?? 0),
    unit: "un",
  };
}

function mapStockToFF(s: any) {
  return {
    external_id: String(s.id),
    stock_quantity: Number(s.stock_quantity ?? 0),
  };
}

// Explode payloads em lista de eventos individuais (1 POST por entidade — exigência do FinanceFlow)
function explodePayload(event: SyncEvent, data: any): { event: SyncEvent; data: any }[] {
  if (event === "order_delivered") {
    if (Array.isArray(data?.orders)) return data.orders.map((o: any) => ({ event, data: mapOrderToFF(o) }));
    if (data?.external_id) return [{ event, data }];
    return [{ event, data: mapOrderToFF(data) }];
  }
  if (event === "order_cancelled") {
    if (Array.isArray(data?.orders)) return data.orders.map((o: any) => ({ event, data: mapCancelToFF(o) }));
    if (data?.external_id) return [{ event, data }];
    return [{ event, data: mapCancelToFF(data) }];
  }
  if (event === "product_upsert") {
    if (Array.isArray(data?.products)) return data.products.map((p: any) => ({ event, data: mapProductToFF(p) }));
    if (data?.external_id) return [{ event, data }];
    return [{ event, data: mapProductToFF(data) }];
  }
  if (event === "stock_change") {
    if (Array.isArray(data?.stock)) return data.stock.map((s: any) => ({ event, data: mapStockToFF(s) }));
    if (data?.external_id) return [{ event, data }];
    return [{ event, data: mapStockToFF(data) }];
  }
  if (event === "product_delete") {
    if (Array.isArray(data?.products)) return data.products.map((p: any) => ({ event, data: { external_id: String(p.id ?? p.external_id) } }));
    return [{ event, data: { external_id: String(data?.external_id ?? data?.id) } }];
  }
  if (event === "full_catalog") {
    // full_catalog vai como UM POST só, com array em data.products (é o único agrupado por design)
    const products = Array.isArray(data?.products) ? data.products.map(mapProductToFF) : [];
    return [{ event, data: { products } }];
  }
  return [{ event, data }];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json() as SyncPayload;
    if (!payload.tenantId || !payload.event) {
      return new Response(JSON.stringify({ error: "tenantId e event são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("integration_settings")
      .select("*")
      .eq("tenant_id", payload.tenantId)
      .maybeSingle();

    if (!settings || !settings.enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: "integração desabilitada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (!settings.financeflow_url) {
      return new Response(JSON.stringify({ skipped: true, reason: "URL do FinanceFlow não configurada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if ((payload.event === "order_delivered" || payload.event === "order_cancelled") && !settings.sync_orders) {
      return new Response(JSON.stringify({ skipped: true, reason: "sync_orders desligado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if ((payload.event === "product_upsert" || payload.event === "product_delete" || payload.event === "full_catalog") && !settings.sync_products) {
      return new Response(JSON.stringify({ skipped: true, reason: "sync_products desligado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (payload.event === "stock_change" && !settings.sync_stock) {
      return new Response(JSON.stringify({ skipped: true, reason: "sync_stock desligado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: tenant } = await supabase
      .from("tenants").select("name, slug").eq("id", payload.tenantId).maybeSingle();
    const storeName = tenant?.name || tenant?.slug || "";

    const endpoint = buildEndpoint(settings.financeflow_url);
    const events = explodePayload(payload.event, payload.data);

    // Dispara 1 POST por evento individual
    const results: any[] = [];
    for (const ev of events) {
      const body = {
        event: ev.event,
        store: storeName,                    // string (nome) — formato pedido pelo FinanceFlow
        data: ev.data,
        sentAt: new Date().toISOString(),
      };
      const r = await postOnce(endpoint, settings.api_key, body);
      results.push(r);
    }

    const allOk = results.every(r => r.ok);
    const firstErr = results.find(r => !r.ok);

    await supabase.from("integration_settings").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: allOk ? "success" : `error_${firstErr?.status ?? 0}`,
      last_sync_error: allOk ? "" : JSON.stringify(firstErr?.body ?? {}).slice(0, 500),
    }).eq("tenant_id", payload.tenantId);

    return new Response(JSON.stringify({
      ok: allOk,
      sent: results.length,
      results,
    }), {
      status: allOk ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("sync-to-financeflow error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
