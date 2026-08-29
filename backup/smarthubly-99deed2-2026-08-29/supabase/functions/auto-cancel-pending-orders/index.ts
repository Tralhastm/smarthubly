// Auto-cancel pending_payment orders after configured timeout per tenant.
// Triggered by pg_cron every 15 minutes. Sends WhatsApp notice to customer.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function whatsappLink(phone: string, text: string) {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { data: cancelled, error } = await supabase.rpc("auto_cancel_expired_orders");
    if (error) throw error;

    const list = cancelled || [];
    console.log(`auto-cancel: ${list.length} orders cancelled`);

    // Agrupa cancelamentos por tenant pra notificar FinanceFlow em lote.
    const byTenant = new Map<string, string[]>();
    for (const row of list as any[]) {
      const arr = byTenant.get(row.t_id) || [];
      arr.push(row.cancelled_id);
      byTenant.set(row.t_id, arr);
    }

    // Para cada cancelamento, registra evento e tenta gerar link de WhatsApp
    const notices: any[] = [];
    for (const row of list as any[]) {
      const tenantId = row.t_id;
      const orderId = row.cancelled_id;

      // Busca tenant para nome / whatsapp da loja
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, slug, whatsapp")
        .eq("id", tenantId)
        .single();

      const storeName = tenant?.name || "a loja";
      const message =
        `Olá ${row.c_name || ""}! Seu pedido em ${storeName} ` +
        `foi cancelado automaticamente porque o pagamento via Pix expirou. ` +
        `Para continuar, é só refazer o pedido. Estamos à disposição!`;

      // Registra order_event para o histórico aparecer pro lojista
      await supabase.from("order_events").insert({
        order_id: orderId,
        tenant_id: tenantId,
        event_type: "auto_cancelled",
        from_status: "pending_payment",
        to_status: "cancelled",
        actor: "system",
        description: "Pix não pago dentro do prazo — cancelado automaticamente",
        metadata: { reason: "pending_payment_expired" },
      });

      const link = whatsappLink(row.c_phone, message);
      notices.push({ orderId, customerPhone: row.c_phone, whatsappLink: link });
    }

    // Avisa FinanceFlow (best-effort, não bloqueia o cron) — 1 chamada por tenant.
    const syncResults: any[] = [];
    for (const [tenantId, orderIds] of byTenant.entries()) {
      try {
        const { data: orders } = await supabase
          .from("orders")
          .select("id, total, payment_method, updated_at, cancel_reason, customer_name, customer_phone")
          .in("id", orderIds);
        if (orders && orders.length > 0) {
          const r = await supabase.functions.invoke("sync-to-financeflow", {
            body: { tenantId, event: "order_cancelled", data: { orders } },
          });
          syncResults.push({ tenantId, count: orders.length, ok: !r.error });
        }
      } catch (e) {
        console.warn("sync order_cancelled falhou (não-bloqueante):", tenantId, e);
        syncResults.push({ tenantId, ok: false, error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, cancelled: list.length, notices, sync: syncResults }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("auto-cancel error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
