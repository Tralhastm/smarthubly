// Envia campanhas de marketing via Brevo (gateway Lovable).
// Body: { campaignId } -> envia para todos os e-mails únicos de orders do tenant
// (excluindo os que estão em email_unsubscribes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getAuthUser, isTenantAdmin } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/brevo";

const SPAM_NOTICE = `<p style="color:#888;font-size:12px;margin-top:24px">Não recebeu algum e-mail nosso? Confira sua caixa de spam ou promoções.</p>`;

function unsubFooter(tenantId: string, email: string) {
  const url = `${SUPABASE_URL}/functions/v1/unsubscribe-public?tenant=${tenantId}&email=${encodeURIComponent(email)}`;
  return `<hr style="margin-top:24px;border:none;border-top:1px solid #eee"/><p style="color:#999;font-size:11px;text-align:center;margin-top:12px">Você está recebendo este e-mail porque é cliente desta loja. <a href="${url}" style="color:#999">Descadastrar</a></p>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { campaignId } = body || {};
    if (!campaignId) return new Response(JSON.stringify({ error: "campaignId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: c } = await supa.from("marketing_campaigns").select("*").eq("id", campaignId).single();
    if (!c) return new Response(JSON.stringify({ error: "campaign not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 🔐 Auth: must be authenticated admin of the campaign's tenant (or super_admin)
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!(await isTenantAdmin(supa, user.id, c.tenant_id))) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    const { data: t } = await supa.from("tenants")
      .select("id, name, marketing_emails_enabled, brevo_sender_email, brevo_sender_name")
      .eq("id", c.tenant_id).single();
    if (!t) return new Response(JSON.stringify({ error: "tenant not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!t.marketing_emails_enabled) return new Response(JSON.stringify({ error: "marketing disabled for this tenant" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!t.brevo_sender_email) return new Response(JSON.stringify({ error: "brevo_sender_email not configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await supa.from("marketing_campaigns").update({ status: "sending" }).eq("id", c.id);

    // coleta e-mails únicos da loja
    const { data: orders } = await supa.from("orders")
      .select("customer_email, customer_name")
      .eq("tenant_id", c.tenant_id)
      .not("customer_email", "is", null);
    const map = new Map<string, string>();
    for (const o of orders || []) {
      const e = (o.customer_email || "").trim().toLowerCase();
      if (e && !map.has(e)) map.set(e, o.customer_name || "");
    }

    const { data: unsubs } = await supa.from("email_unsubscribes").select("email").eq("tenant_id", c.tenant_id);
    for (const u of unsubs || []) map.delete((u.email || "").toLowerCase());

    const recipients = Array.from(map.entries());
    let ok = 0, fail = 0;
    const errs: string[] = [];

    for (const [email, name] of recipients) {
      const html = (c.body_html || "")
        .replaceAll("{{nome}}", name || "cliente")
        .replaceAll("{{loja}}", t.name)
        + SPAM_NOTICE
        + unsubFooter(t.id, email);

      try {
        const res = await fetch(`${GATEWAY_URL}/smtp/email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": BREVO_API_KEY,
          },
          body: JSON.stringify({
            sender: { name: t.brevo_sender_name || t.name, email: t.brevo_sender_email },
            to: [{ email, name }],
            subject: c.subject,
            htmlContent: `<html><body style="font-family:Arial,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:20px">${html}</body></html>`,
          }),
        });
        if (res.ok) ok++;
        else { fail++; errs.push(`${email}: ${res.status}`); }
      } catch (e: any) {
        fail++; errs.push(`${email}: ${e.message}`);
      }
    }

    await supa.from("marketing_campaigns").update({
      status: fail === 0 ? "sent" : (ok === 0 ? "failed" : "partial"),
      sent_at: new Date().toISOString(),
      recipients_count: recipients.length,
      succeeded_count: ok,
      failed_count: fail,
      error_message: errs.slice(0, 5).join("; ") || null,
    }).eq("id", c.id);

    return new Response(JSON.stringify({ ok: true, recipients: recipients.length, succeeded: ok, failed: fail }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-marketing-campaign error", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
