// #25 — Detector de pedidos fantasma
// Roda a cada 30min: marca pedidos out-for-delivery sem update há 90min como "fantasma" + cria sugestão pro lojista contatar
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: flagged, error } = await supabase.rpc("detect_ghost_orders");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Para cada pedido marcado, cria evento + sugestão por tenant (consolidada)
  const byTenant = new Map<string, any[]>();
  for (const f of flagged ?? []) {
    if (!byTenant.has(f.flagged_tenant)) byTenant.set(f.flagged_tenant, []);
    byTenant.get(f.flagged_tenant)!.push(f.flagged_order);
  }

  for (const [tenantId, orderIds] of byTenant.entries()) {
    await supabase.from("automation_suggestions").insert({
      tenant_id: tenantId,
      type: "ghost_orders",
      title: `${orderIds.length} pedido(s) fantasma detectado(s)`,
      description: `Pedidos saíram para entrega há 90min mas ninguém confirmou. Ligue para o cliente ou para o entregador.`,
      payload: { order_ids: orderIds },
    });

    for (const orderId of orderIds) {
      await supabase.from("order_events").insert({
        tenant_id: tenantId,
        order_id: orderId,
        event_type: "ghost_flagged",
        actor: "system",
        description: "Pedido marcado como fantasma — sem confirmação há 90min",
      });
    }
  }

  await supabase.from("automation_runs").insert({
    automation_type: "ghost_detector",
    status: "success",
    metrics: { orders_flagged: flagged?.length ?? 0 },
  });

  return new Response(JSON.stringify({ ok: true, flagged: flagged?.length ?? 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
