import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export async function send_billing(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { invoice_id, test_email } = body as { invoice_id?: string; test_email?: string };

    let recipientEmail = test_email;
    let templateData: Record<string, any>;
    let idempotencyKey: string;

    if (invoice_id) {
      const { data: inv, error: invErr } = await supabase
        .from("billing_invoices")
        .select("*, tenants(name, billing_email, slug)")
        .eq("id", invoice_id)
        .single();
      if (invErr || !inv) throw new Error("Cobrança não encontrada");

      recipientEmail = test_email || inv.tenants?.billing_email;
      if (!recipientEmail) throw new Error("Lojista não tem e-mail de cobrança cadastrado");

      templateData = {
        tenantName: inv.tenants?.name || "Lojista",
        amount: Number(inv.amount),
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        dueDate: inv.due_date,
        ordersCount: inv.orders_count,
        isOverdue: inv.status === "overdue",
        isTest: !!test_email,
      };
      idempotencyKey = `invoice-${invoice_id}-${test_email ? "test" : "real"}-${Date.now()}`;
    } else {
      // Modo teste sem fatura real
      if (!recipientEmail) throw new Error("Informe um e-mail de teste");
      templateData = {
        tenantName: "Loja Teste",
        amount: 60,
        periodStart: new Date(Date.now() - 30 * 86400000).toISOString(),
        periodEnd: new Date().toISOString(),
        dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
        ordersCount: 12,
        isOverdue: false,
        isTest: true,
      };
      idempotencyKey = `billing-test-${recipientEmail}-${Date.now()}`;
    }

    const { data, error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "billing-invoice",
        recipientEmail,
        idempotencyKey,
        templateData,
      },
    });

    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);

    return new Response(JSON.stringify({ success: true, to: recipientEmail, ...data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-billing-email error", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  } catch (e) {
    console.error("[unified:send-billing] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
