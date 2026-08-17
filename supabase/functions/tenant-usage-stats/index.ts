// Calcula consumo estimado por loja (rows, storage proxy, cobrança projetada).
// Acesso: super_admin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "no_auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { data: roleRow } = await userClient
      .from("platform_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    // Service role pra contar tudo sem RLS
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenants, error: tErr } = await admin
      .from("tenants")
      .select("id, name, slug, active, billing_mode, monthly_fee, platform_fee_percent, created_at");
    if (tErr) throw tErr;

    const tables = [
      "orders", "order_items", "order_events", "order_chats", "order_chat_messages",
      "products", "financial_entries", "appointments", "reviews",
      "automation_runs", "push_subscriptions", "ai_workers",
    ];

    const results: any[] = [];
    for (const t of tenants ?? []) {
      const counts: Record<string, number> = {};
      let totalRows = 0;
      for (const tbl of tables) {
        try {
          const { count } = await admin.from(tbl).select("*", { count: "exact", head: true }).eq("tenant_id", t.id);
          counts[tbl] = count ?? 0;
          totalRows += count ?? 0;
        } catch { counts[tbl] = 0; }
      }

      // Faturamento últimos 30 dias
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data: orders30 } = await admin
        .from("orders").select("total, platform_fee, created_at, status")
        .eq("tenant_id", t.id).gte("created_at", since);
      const orders30Count = orders30?.length ?? 0;
      const revenue30 = (orders30 ?? []).reduce((s, o) => s + Number(o.total ?? 0), 0);
      const platformFees30 = (orders30 ?? []).reduce((s, o) => s + Number(o.platform_fee ?? 0), 0);

      // Custo estimado: ~R$ 0,002 por row + R$ 0,01 por pedido (edge functions / realtime)
      const estimatedCostBRL = totalRows * 0.002 + orders30Count * 0.01 + 0.50; // 0.50 base
      const billed = t.billing_mode === "monthly_fixed"
        ? Number(t.monthly_fee ?? 0)
        : platformFees30;
      const margin = billed - estimatedCostBRL;
      const marginPct = billed > 0 ? (margin / billed) * 100 : null;

      results.push({
        id: t.id, name: t.name, slug: t.slug, active: t.active,
        billing_mode: t.billing_mode, monthly_fee: Number(t.monthly_fee ?? 0),
        counts, total_rows: totalRows,
        orders_30d: orders30Count, revenue_30d: revenue30, platform_fees_30d: platformFees30,
        estimated_cost_brl: Number(estimatedCostBRL.toFixed(2)),
        billed_brl: Number(billed.toFixed(2)),
        margin_brl: Number(margin.toFixed(2)),
        margin_pct: marginPct !== null ? Number(marginPct.toFixed(1)) : null,
      });
    }

    const totals = results.reduce((acc, r) => ({
      tenants: acc.tenants + 1,
      total_rows: acc.total_rows + r.total_rows,
      orders_30d: acc.orders_30d + r.orders_30d,
      revenue_30d: acc.revenue_30d + r.revenue_30d,
      estimated_cost_brl: acc.estimated_cost_brl + r.estimated_cost_brl,
      billed_brl: acc.billed_brl + r.billed_brl,
      margin_brl: acc.margin_brl + r.margin_brl,
    }), { tenants: 0, total_rows: 0, orders_30d: 0, revenue_30d: 0, estimated_cost_brl: 0, billed_brl: 0, margin_brl: 0 });

    return json({
      tenants: results.sort((a, b) => b.estimated_cost_brl - a.estimated_cost_brl),
      totals,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[tenant-usage-stats]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
