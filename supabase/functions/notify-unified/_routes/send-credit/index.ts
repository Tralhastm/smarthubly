import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export async function send_credit(req: Request, body?: unknown): Promise<Response> {
  try {
    const ct = req.headers.get("content-type") || "";
    const parsed: any = body ?? (ct.includes("application/json") ? await req.json() : {});
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { credit_account_id, test_email } = await req.json();
    if (!credit_account_id) throw new Error("credit_account_id obrigatório");

    const { data: acc, error } = await supabase
      .from("credit_accounts")
      .select("*, tenants(name, pix_key, phone, whatsapp)")
      .eq("id", credit_account_id)
      .single();

    if (error || !acc) throw new Error("Fiado não encontrado");

    const recipient = test_email || acc.customer_email;
    if (!recipient) throw new Error("Cliente sem e-mail cadastrado");

    const due = new Date(acc.due_date).getTime();
    const now = Date.now();
    const daysOverdue = Math.max(0, Math.floor((now - due) / 86400000));
    const isOverdue = daysOverdue > 0 && Number(acc.amount_paid) < Number(acc.amount);

    const templateData = {
      customerName: acc.customer_name,
      storeName: acc.tenants?.name || "Loja",
      amount: Number(acc.amount),
      amountPaid: Number(acc.amount_paid),
      description: acc.description || "",
      dueDate: acc.due_date,
      daysOverdue,
      pixKey: acc.tenants?.pix_key || "",
      storePhone: acc.tenants?.whatsapp || acc.tenants?.phone || "",
      isOverdue,
      reminderNumber: (acc.reminders_sent || 0) + 1,
    };

    const idempotencyKey = `credit-${credit_account_id}-${(acc.reminders_sent || 0) + 1}-${Date.now()}`;

    const { data: sendResp, error: sendErr } = await supabase.functions.invoke(
      "send-transactional-email",
      {
        body: {
          templateName: "credit-reminder",
          recipientEmail: recipient,
          idempotencyKey,
          templateData,
        },
      }
    );

    if (sendErr) throw sendErr;
    if ((sendResp as any)?.error) throw new Error((sendResp as any).error);

    // Atualizar contador (apenas se não foi teste)
    if (!test_email) {
      await supabase
        .from("credit_accounts")
        .update({
          reminders_sent: (acc.reminders_sent || 0) + 1,
          last_reminder_at: new Date().toISOString(),
          status: isOverdue ? "overdue" : acc.status,
        })
        .eq("id", credit_account_id);
    }

    return new Response(
      JSON.stringify({ success: true, to: recipient, daysOverdue, isOverdue }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("send-credit-reminder error", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  } catch (e) {
    console.error("[unified:send-credit] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
