import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthUser, isSuperAdmin } from "../../../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FREQUENCY_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 15,
  monthly: 30,
};

export async function generate(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, key);

    // 🔐 Auth: super_admin OR internal cron (service-role key as Bearer)
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace("Bearer ", "");
    const isServiceRole = bearer && bearer === key;
    if (!isServiceRole) {
      const user = await getAuthUser(req);
      if (!user || !(await isSuperAdmin(supabase, user.id))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    let body: { tenant_id?: string; force?: boolean } = {};
    try { body = await req.json(); } catch { /* cron call has no body */ }

    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id, name, billing_frequency, billing_grace_days, last_invoice_at, created_at, billing_blocked_until, billing_mode, monthly_fee, platform_fee_percent, billing_email, billing_status, billing_warning_sent_at, billing_degraded_at, billing_suspended_at")
      .eq("active", true)
      .eq("is_donated", false);
    if (tErr) throw tErr;

    const now = new Date();
    const generated: any[] = [];

    for (const t of tenants || []) {
      if (body.tenant_id && t.id !== body.tenant_id) continue;

      const billingMode = (t as any).billing_mode || "per_order";
      const freq = billingMode === "monthly_fixed" ? "monthly" : (t.billing_frequency || "monthly");
      const days = FREQUENCY_DAYS[freq] || 30;
      const lastInvoice = t.last_invoice_at ? new Date(t.last_invoice_at) : new Date(t.created_at);
      const nextDue = new Date(lastInvoice.getTime() + days * 86400000);

      if (!body.force && now < nextDue) continue;

      const periodStart = lastInvoice.toISOString();
      const periodEnd = now.toISOString();

      let amount = 0;
      let ordersCount = 0;

      if (billingMode === "monthly_fixed") {
        amount = Number((t as any).monthly_fee || 60);
        const { count } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id)
          .gte("created_at", periodStart)
          .lt("created_at", periodEnd)
          .neq("status", "cancelled");
        ordersCount = count || 0;
      } else {
        const { data: orders } = await supabase
          .from("orders")
          .select("platform_fee, status")
          .eq("tenant_id", t.id)
          .gte("created_at", periodStart)
          .lt("created_at", periodEnd);

        const validOrders = (orders || []).filter((o: any) => o.status !== "cancelled" && Number(o.platform_fee || 0) > 0);
        amount = validOrders.reduce((s: number, o: any) => s + Number(o.platform_fee || 0), 0);
        ordersCount = validOrders.length;
      }

      if (amount <= 0) {
        await supabase.from("tenants").update({ last_invoice_at: now.toISOString() }).eq("id", t.id);
        continue;
      }

      const dueDate = new Date(now.getTime() + (t.billing_grace_days || 5) * 86400000);

      const { data: invoice, error: invErr } = await supabase.from("billing_invoices").insert({
        tenant_id: t.id,
        period_start: periodStart,
        period_end: periodEnd,
        orders_count: ordersCount,
        amount: Math.round(amount * 100) / 100,
        status: "pending",
        due_date: dueDate.toISOString(),
      }).select().single();

      if (invErr) {
        console.error("invoice error", invErr);
        continue;
      }

      await supabase.from("tenants").update({ last_invoice_at: now.toISOString() }).eq("id", t.id);
      generated.push(invoice);

      // 📧 Auto-envia email se houver email cadastrado
      if (t.billing_email) {
        try {
          await supabase.functions.invoke("send-billing-email", {
            body: { invoice_id: invoice.id },
          });
          console.log(`Billing email sent for tenant ${t.id} invoice ${invoice.id}`);
        } catch (e) {
          console.error("send-billing-email failed:", e);
        }
      }
    }

    // ─────────────────────────────────────────────────────
    // BLOQUEIO ESCALONADO: aviso → degradado → suspenso
    // ─────────────────────────────────────────────────────
    const { data: overdue } = await supabase
      .from("billing_invoices")
      .select("id, tenant_id, due_date, status, tenants!inner(name, billing_email, billing_status, billing_warning_sent_at, billing_degraded_at)")
      .in("status", ["pending", "payment_declared", "overdue"])
      .lt("due_date", now.toISOString());

    let warned = 0, degraded = 0, suspended = 0;

    for (const inv of overdue || []) {
      const tenantId = inv.tenant_id;
      const dueAt = new Date(inv.due_date);
      const daysOverdue = Math.floor((now.getTime() - dueAt.getTime()) / 86400000);
      const tenant: any = inv.tenants;

      // Marca invoice como overdue
      if (inv.status !== "overdue") {
        await supabase.from("billing_invoices").update({ status: "overdue" }).eq("id", inv.id);
      }

      // Estágio 1 (D+1): aviso por email
      if (daysOverdue >= 1 && !tenant.billing_warning_sent_at) {
        if (tenant.billing_email) {
          try {
            await supabase.functions.invoke("send-billing-email", { body: { invoice_id: inv.id } });
          } catch (e) { console.error("warning email failed", e); }
        }
        await supabase.from("tenants").update({
          billing_status: "warning",
          billing_warning_sent_at: now.toISOString(),
        }).eq("id", tenantId);
        warned++;
      }

      // Estágio 2 (D+5): degradar (banner no admin, mas loja segue funcionando)
      if (daysOverdue >= 5 && !tenant.billing_degraded_at) {
        await supabase.from("tenants").update({
          billing_status: "degraded",
          billing_degraded_at: now.toISOString(),
        }).eq("id", tenantId);
        degraded++;
      }

      // Estágio 3 (D+10): suspender loja
      if (daysOverdue >= 10) {
        const block = new Date(now.getTime() + 30 * 86400000);
        await supabase.from("tenants").update({
          billing_status: "suspended",
          billing_suspended_at: now.toISOString(),
          billing_blocked_until: block.toISOString(),
        }).eq("id", tenantId);
        suspended++;
      }
    }

    // ↩️ Reset escalonamento quando faturas voltam a estar pagas
    const { data: cleanTenants } = await supabase
      .from("tenants")
      .select("id")
      .neq("billing_status", "active");

    for (const ct of cleanTenants || []) {
      const { count } = await supabase
        .from("billing_invoices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", ct.id)
        .in("status", ["overdue"]);
      if (!count) {
        await supabase.from("tenants").update({
          billing_status: "active",
          billing_warning_sent_at: null,
          billing_degraded_at: null,
          billing_suspended_at: null,
          billing_blocked_until: null,
        }).eq("id", ct.id);
      }
    }

    return new Response(JSON.stringify({
      generated: generated.length,
      overdue: overdue?.length || 0,
      warned, degraded, suspended,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-invoices error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  } catch (e) {
    console.error("[unified:generate] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
