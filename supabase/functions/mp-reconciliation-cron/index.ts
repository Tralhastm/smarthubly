// Cron diário (#19) — Reconciliação Mercado Pago
// Cruza pagamentos aprovados das últimas 24h com pedidos no banco e registra divergências.
// Esta função é independente dos webhooks de confirmação de pagamento.
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

const fetchPaymentsForTenant = async (accessToken: string, fromIso: string, toIso: string) => {
  const limit = 200;
  const maxPages = 50;
  const payments = new Map<string, any>();
  let offset = 0;
  let processed = 0;
  let total: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      sort: "date_created",
      criteria: "desc",
      begin_date: fromIso,
      end_date: toIso,
      limit: String(limit),
      offset: String(offset),
    });
    const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`MP search failed at offset ${offset}: ${res.status}`);

    const response = await res.json();
    const result = Array.isArray(response) ? response[0] : response;
    if (!result || !Array.isArray(result.results)) {
      throw new Error(`MP search returned an invalid page at offset ${offset}`);
    }
    const pageResults = result.results as any[];
    const reportedTotal = Number(result.paging?.total);
    if (result.paging?.total !== undefined && result.paging?.total !== null && Number.isFinite(reportedTotal) && reportedTotal >= 0) {
      total = reportedTotal;
      if (total > limit * maxPages) {
        throw new Error(`MP reconciliation limit exceeded: ${total} payments in the 24-hour window (maximum ${limit * maxPages})`);
      }
    }

    for (const payment of pageResults) {
      if (payment?.id === undefined || payment?.id === null) {
        throw new Error(`MP search returned a payment without an id at offset ${offset}`);
      }
      payments.set(String(payment.id), payment);
    }
    processed += pageResults.length;

    if (total !== null && offset + pageResults.length >= total) return [...payments.values()];
    if (pageResults.length === 0) return [...payments.values()];
    const pageLimit = Number(result.paging?.limit) || limit;
    if (total === null && pageResults.length < pageLimit) return [...payments.values()];
    offset += pageResults.length;
  }

  if (total !== null && processed >= total) return [...payments.values()];
  throw new Error(`MP reconciliation stopped at the safety cap of ${limit * maxPages} payments before reaching the reported total`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = new Date().toISOString();

  // Apenas lojas ativas que usam checkout próprio e têm token MP.
  const { data: tenants, error: tenantError } = await supabase
    .from("tenants")
    .select("id, mercadopago_token, auto_reconcile_mp, store_mode")
    .eq("active", true)
    .eq("auto_reconcile_mp", true)
    .or("store_mode.is.null,store_mode.neq.affiliate")
    .not("mercadopago_token", "is", null);

  if (tenantError) {
    await supabase.from("automation_runs").insert({
      automation_type: "mp_reconciliation",
      status: "error",
      metrics: { tenants_run: 0, failed_runs: 1, total_divergences: 0 },
      error_message: tenantError.message,
    });
    return new Response(JSON.stringify({ ok: false, error: tenantError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let totalRuns = 0;
  let totalDivergent = 0;
  let failedRuns = 0;

  for (const tenant of tenants ?? []) {
    if (!tenant.mercadopago_token) continue;
    try {
      const payments = await fetchPaymentsForTenant(tenant.mercadopago_token, periodStart, periodEnd);
      const approved = payments.filter((p: any) => p.status === "approved");
      const divergences: Divergence[] = [];
      let matched = 0;

      for (let start = 0; start < approved.length; start += 200) {
        const batch = approved.slice(start, start + 200);
        const externalReferences = [...new Set(batch
          .map((payment: any) => payment.external_reference)
          .filter((reference: unknown): reference is string => typeof reference === "string" && reference.length > 0))];
        const ordersById = new Map<string, any>();
        if (externalReferences.length > 0) {
          const { data: orders, error: orderError } = await supabase
            .from("orders")
            .select("id, total, status, tenant_id")
            .in("id", externalReferences);
          if (orderError) throw orderError;
          for (const order of orders || []) ordersById.set(String(order.id), order);
        }

        for (const p of batch) {
          const extRef: string | undefined = p.external_reference;
          if (!extRef) {
            divergences.push({ payment_id: String(p.id), amount: p.transaction_amount, status: p.status, reason: "payment_without_external_reference" });
            continue;
          }
          const order = ordersById.get(extRef);
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
      }

      const { error: runInsertError } = await supabase.from("mp_reconciliation_runs").insert({
        tenant_id: tenant.id,
        period_start: periodStart,
        period_end: periodEnd,
        payments_checked: approved.length,
        matched,
        divergent: divergences.length,
        divergences: divergences.slice(0, 50),
        status: "success",
      });
      if (runInsertError) throw runInsertError;

      if (divergences.length > 0) {
        totalDivergent += divergences.length;
        const dedupeKey = `mp-divergence-${periodStart.slice(0, 10)}`;
        const { data: previous, error: previousError } = await supabase.from("automation_suggestions")
          .select("id").eq("tenant_id", tenant.id).eq("type", "mp_divergence")
          .eq("status", "pending").contains("payload", { dedupe_key: dedupeKey }).limit(1);
        if (previousError) throw previousError;
        if (!previous?.length) {
          const { error: suggestionError } = await supabase.from("automation_suggestions").insert({
            tenant_id: tenant.id,
            type: "mp_divergence",
            title: `Reconciliação MP: ${divergences.length} divergência(s)`,
            description: `Encontramos ${divergences.length} pagamento(s) aprovado(s) com inconsistências nas últimas 24h. Revise antes de pagar a plataforma.`,
            payload: { divergences: divergences.slice(0, 10), dedupe_key: dedupeKey },
            status: "pending",
          });
          if (suggestionError) throw suggestionError;
        }
      }
      totalRuns++;
    } catch (err: any) {
      failedRuns++;
      const { error: errorRunInsert } = await supabase.from("mp_reconciliation_runs").insert({
        tenant_id: tenant.id,
        period_start: periodStart,
        period_end: periodEnd,
        status: "error",
        error_message: String(err?.message || err),
      });
      if (errorRunInsert) console.error("Failed to record MP reconciliation error", errorRunInsert);
    }
  }

  const runStatus = failedRuns > 0 ? "error" : "success";
  const { error: summaryInsertError } = await supabase.from("automation_runs").insert({
    automation_type: "mp_reconciliation",
    status: runStatus,
    metrics: { tenants_run: totalRuns, failed_runs: failedRuns, total_divergences: totalDivergent },
    error_message: failedRuns > 0 ? `${failedRuns} loja(s) falharam na reconciliação.` : null,
  });
  if (summaryInsertError) console.error("Failed to record MP reconciliation summary", summaryInsertError);

  return new Response(JSON.stringify({ ok: failedRuns === 0, tenants: totalRuns, failed: failedRuns, divergent: totalDivergent }), {
    status: failedRuns > 0 ? 500 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
