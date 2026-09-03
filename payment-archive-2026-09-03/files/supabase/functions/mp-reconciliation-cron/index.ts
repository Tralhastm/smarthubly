// Cron diário (#19) — Reconciliação Mercado Pago
// Cruza pagamentos aprovados das últimas 24h com pedidos no banco e flagga divergências
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Divergence {
  payment_id: string;
  amount: number;
  status: string;
  external_reference?: string;
  reason: string;
}

const fetchPaymentsForTenant = async (accessToken: string, fromIso: string) => {
  const url = `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&begin_date=${encodeURIComponent(fromIso)}&end_date=NOW&limit=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`MP search failed: ${res.status}`);
  const data = await res.json();
  return data?.results ?? [];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = new Date().toISOString();

  // Lojas com toggle ativo + token MP
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, mp_access_token, auto_reconcile_mp, store_mode")
    .eq("auto_reconcile_mp", true)
    .neq("store_mode", "affiliate")
    .not("mp_access_token", "is", null);

  let totalRuns = 0;
  let totalDivergent = 0;

  for (const tenant of tenants ?? []) {
    if (!tenant.mp_access_token) continue;
    try {
      const payments = await fetchPaymentsForTenant(tenant.mp_access_token, periodStart);
      const approved = payments.filter((p: any) => p.status === "approved");

      const divergences: Divergence[] = [];
      let matched = 0;

      for (const p of approved) {
        const extRef: string | undefined = p.external_reference;
        if (!extRef) {
          divergences.push({
            payment_id: String(p.id),
            amount: p.transaction_amount,
            status: p.status,
            reason: "payment_without_external_reference",
          });
          continue;
        }
        const { data: order } = await supabase
          .from("orders")
          .select("id, total, status, tenant_id")
          .eq("id", extRef)
          .maybeSingle();

        if (!order) {
          divergences.push({ payment_id: String(p.id), amount: p.transaction_amount, status: p.status, external_reference: extRef, reason: "order_not_found" });
          continue;
        }
        if (order.tenant_id !== tenant.id) {
          divergences.push({ payment_id: String(p.id), amount: p.transaction_amount, status: p.status, external_reference: extRef, reason: "tenant_mismatch" });
          continue;
        }
        const totalDiff = Math.abs(Number(order.total) - Number(p.transaction_amount));
        if (totalDiff > 0.5) {
          divergences.push({ payment_id: String(p.id), amount: p.transaction_amount, status: p.status, external_reference: extRef, reason: `amount_mismatch_order=${order.total}` });
          continue;
        }
        if (order.status === "pending_payment" || order.status === "cancelled") {
          divergences.push({ payment_id: String(p.id), amount: p.transaction_amount, status: p.status, external_reference: extRef, reason: `paid_but_order_status=${order.status}` });
          continue;
        }
        matched++;
      }

      await supabase.from("mp_reconciliation_runs").insert({
        tenant_id: tenant.id,
        period_start: periodStart,
        period_end: periodEnd,
        payments_checked: approved.length,
        matched,
        divergent: divergences.length,
        divergences: divergences.slice(0, 50),
        status: "success",
      });

      // Cria sugestão se houver divergências
      if (divergences.length > 0) {
        await supabase.from("automation_suggestions").insert({
          tenant_id: tenant.id,
          type: "mp_divergence",
          title: `Reconciliação MP: ${divergences.length} divergência(s)`,
          description: `Encontramos ${divergences.length} pagamento(s) aprovado(s) com inconsistências nas últimas 24h. Revise antes de pagar a plataforma.`,
          payload: { divergences: divergences.slice(0, 10) },
        });
        totalDivergent += divergences.length;
      }

      totalRuns++;
    } catch (err: any) {
      await supabase.from("mp_reconciliation_runs").insert({
        tenant_id: tenant.id,
        period_start: periodStart,
        period_end: periodEnd,
        status: "error",
        error_message: String(err?.message || err),
      });
    }
  }

  await supabase.from("automation_runs").insert({
    automation_type: "mp_reconciliation",
    status: "success",
    metrics: { tenants_run: totalRuns, total_divergences: totalDivergent },
  });

  return new Response(JSON.stringify({ ok: true, tenants: totalRuns, divergent: totalDivergent }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
