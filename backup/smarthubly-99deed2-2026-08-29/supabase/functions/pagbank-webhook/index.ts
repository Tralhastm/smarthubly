// PagBank webhook handler — recebe notificações de status de cobrança e atualiza
// o pedido + a transação. PagBank manda POST com o "order" inteiro no body.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mapeia status PagBank → status interno
function mapStatus(pbStatus: string | undefined): "paid" | "failed" | "cancelled" | "pending" | "refunded" {
  const s = String(pbStatus || "").toUpperCase();
  if (s === "PAID" || s === "AUTHORIZED") return "paid";
  if (s === "DECLINED") return "failed";
  if (s === "CANCELED" || s === "CANCELLED") return "cancelled";
  if (s === "REFUNDED") return "refunded";
  return "pending";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    console.log("PagBank webhook:", JSON.stringify(body).slice(0, 800));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // PagBank pode mandar formatos diferentes (order, charge). Tentamos ambos.
    const externalId: string | undefined = body?.id || body?.order_id || body?.charges?.[0]?.id;
    const referenceId: string | undefined = body?.reference_id;
    // Status pode estar no order ou na charge
    const chargeStatus = body?.charges?.[0]?.status;
    const orderStatus = body?.status;
    const internalStatus = mapStatus(chargeStatus || orderStatus);

    if (!externalId && !referenceId) {
      return new Response(JSON.stringify({ ok: false, error: "no_id" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Localiza transação
    let txQuery = supabase.from("payment_transactions").select("id, order_id, tenant_id, status").eq("provider", "pagbank");
    if (externalId) txQuery = txQuery.eq("external_id", externalId);
    else if (referenceId) txQuery = txQuery.eq("external_reference", referenceId);
    const { data: tx } = await txQuery.maybeSingle();

    if (!tx) {
      // Fallback: tenta achar pelo reference_id direto no orders
      if (referenceId) {
        await supabase.from("orders").update({
          status: internalStatus === "paid" ? "received" : (internalStatus === "cancelled" ? "cancelled" : undefined),
          updated_at: new Date().toISOString(),
        }).eq("id", referenceId);
      }
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atualiza transação
    await supabase.from("payment_transactions").update({
      status: internalStatus,
      raw_webhook: body,
      updated_at: new Date().toISOString(),
    }).eq("id", tx.id);

    // Atualiza pedido: pago -> 'received'; cancelado/falha -> 'cancelled'
    if (tx.order_id) {
      if (internalStatus === "paid") {
        await supabase.from("orders").update({
          status: "received",
          updated_at: new Date().toISOString(),
        }).eq("id", tx.order_id).neq("status", "delivered");
      } else if (internalStatus === "cancelled" || internalStatus === "failed") {
        await supabase.from("orders").update({
          status: "cancelled",
          cancel_reason: `pagbank_${internalStatus}`,
          updated_at: new Date().toISOString(),
        }).eq("id", tx.order_id).eq("status", "pending_payment");
      }
    }

    return new Response(JSON.stringify({ ok: true, status: internalStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("PagBank webhook error:", err);
    // Sempre 200 pra PagBank não ficar reenviando infinito
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
