// #25 — Detector de pedidos fantasma.
// Roda a cada 30 min: encontra pedidos em rota sem atualização há 90 min,
// grava flag, sugestão e eventos em uma transação idempotente e auditável.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  let flagsFound = 0;
  let notificationsProcessed = 0;

  try {
    const { data: flagged, error: detectError } = await supabase.rpc("detect_ghost_orders");
    if (detectError) throw new Error(`Falha ao detectar pedidos: ${detectError.message}`);
    flagsFound = flagged?.length ?? 0;

    const grouped = new Map<string, string[]>();
    for (const flag of flagged ?? []) {
      const tenantId = String(flag.flagged_tenant);
      const ids = grouped.get(tenantId) || [];
      ids.push(String(flag.flagged_id));
      grouped.set(tenantId, ids);
    }

    for (const [tenantId, flagIds] of grouped) {
      const { data: result, error: processError } = await supabase.rpc("process_ghost_order_notifications", {
        _flag_ids: flagIds,
      });
      if (processError) throw new Error(`Falha ao notificar loja ${tenantId}: ${processError.message}`);
      if (!result?.ok) throw new Error(`A transação de notificação da loja ${tenantId} não confirmou sucesso.`);
      notificationsProcessed += Number(result.processed || 0);
    }

    const metrics = {
      flags_found: flagsFound,
      notifications_processed: notificationsProcessed,
      tenants_notified: grouped.size,
      duration_ms: Date.now() - startedAt,
    };
    const { error: logError } = await supabase.from("automation_runs").insert({
      automation_type: "ghost_detector",
      status: "success",
      metrics,
    });
    if (logError) throw new Error(`Falha ao registrar execução: ${logError.message}`);

    return new Response(JSON.stringify({ ok: true, ...metrics }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = errorText(error);
    console.error("ghost-orders-detector error", message);
    const { error: logError } = await supabase.from("automation_runs").insert({
      automation_type: "ghost_detector",
      status: "error",
      metrics: { flags_found: flagsFound, notifications_processed: notificationsProcessed, duration_ms: Date.now() - startedAt },
      error_message: message,
    });
    if (logError) console.error("ghost-orders-detector run log failed", logError.message);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
