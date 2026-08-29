// #4 Cupom de carrinho abandonado.
// Roda a cada 30min. Para tenants com auto_abandon_coupon=true,
// pega cart_sessions sem conversão, sem notificação e parados há 1-24h.
// Gera cupom único de 10% off, salva em coupons, marca cart_session.coupon_code.
// (O envio para o cliente fica como suggestion para o lojista mandar manualmente via WhatsApp,
// pra não vazar PII em emails sem opt-in claro).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: tenants } = await supa.from("tenants").select("id, name, store_mode, marketing_emails_enabled, abandoned_cart_email_enabled, brevo_sender_email, brevo_sender_name").eq("auto_abandon_coupon", true).neq("store_mode", "affiliate");
    if (!tenants || tenants.length === 0) return new Response(JSON.stringify({ ok: true, tenants: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
    const GATEWAY_URL = "https://connector-gateway.lovable.dev/brevo";

    let totalCoupons = 0, totalSuggestions = 0, totalEmails = 0;
    for (const t of tenants) {
      const { data: carts } = await supa.from("cart_sessions")
        .select("id, customer_phone, customer_name, customer_email, items, total")
        .eq("tenant_id", t.id)
        .is("converted_order_id", null)
        .is("abandoned_notified_at", null)
        .lte("last_activity_at", oneHourAgo)
        .gte("last_activity_at", oneDayAgo)
        .gt("total", 0)
        .limit(50);

      for (const cart of carts || []) {
        const code = `VOLTA${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const { error: cErr } = await supa.from("coupons").insert({
          tenant_id: t.id, code, discount_type: "percent", discount_value: 10,
          min_order_value: 0, max_uses: 1, active: true,
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        });
        if (cErr) { console.error("coupon insert fail", cErr); continue; }
        totalCoupons++;

        await supa.from("cart_sessions").update({
          coupon_code: code,
          abandoned_notified_at: new Date().toISOString(),
        }).eq("id", cart.id);

        await supa.from("automation_suggestions").insert({
          tenant_id: t.id, type: "abandoned_cart",
          title: `Carrinho abandonado: ${cart.customer_name || cart.customer_phone}`,
          description: `R$ ${Number(cart.total).toFixed(2)} no carrinho. Cupom ${code} (10% off, válido 7d) gerado. Mande WhatsApp pra ${cart.customer_phone}.`,
          payload: { cart_id: cart.id, phone: cart.customer_phone, name: cart.customer_name, total: cart.total, coupon_code: code },
          status: "pending",
        });
        totalSuggestions++;

        // Envia e-mail via Brevo se loja configurou
        if (cart.customer_email && t.marketing_emails_enabled && t.abandoned_cart_email_enabled && t.brevo_sender_email && LOVABLE_API_KEY && BREVO_API_KEY) {
          // checa unsubscribe
          const { data: unsub } = await supa.from("email_unsubscribes").select("id").eq("tenant_id", t.id).eq("email", cart.customer_email.toLowerCase()).maybeSingle();
          if (unsub) continue;
          const unsubUrl = `${SUPABASE_URL}/functions/v1/notify-unified/unsubscribe-public?tenant=${t.id}&email=${encodeURIComponent(cart.customer_email)}`;
          const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
            <h1 style="color:#3b82f6">Esqueceu algo, ${cart.customer_name || ''}? 🛒</h1>
            <p>Você deixou itens no carrinho da <b>${t.name}</b>. Que tal finalizar agora com <b>10% OFF</b>?</p>
            <div style="background:#f3f4f6;padding:16px;border-radius:8px;text-align:center;margin:20px 0">
              <div style="color:#6b7280;font-size:12px">CUPOM</div>
              <div style="font-size:28px;font-weight:700;color:#10b981;letter-spacing:2px">${code}</div>
              <div style="color:#6b7280;font-size:12px">Válido por 7 dias</div>
            </div>
            <p style="color:#888;font-size:12px;margin-top:24px">Não recebeu nosso e-mail antes? Confira sua caixa de spam ou promoções.</p>
            <hr style="margin-top:24px;border:none;border-top:1px solid #eee"/>
            <p style="color:#999;font-size:11px;text-align:center"><a href="${unsubUrl}" style="color:#999">Não quero mais receber estes e-mails</a></p>
          </div>`;
          try {
            const r = await fetch(`${GATEWAY_URL}/smtp/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": BREVO_API_KEY },
              body: JSON.stringify({
                sender: { name: t.brevo_sender_name || t.name, email: t.brevo_sender_email },
                to: [{ email: cart.customer_email, name: cart.customer_name || "" }],
                subject: `🛒 Esqueceu algo? ${code} = 10% OFF na ${t.name}`,
                htmlContent: html,
              }),
            });
            if (r.ok) totalEmails++;
          } catch (e) { console.error("brevo send fail", e); }
        }
      }
    }

    await supa.from("automation_runs").insert({
      automation_type: "abandoned_cart_cron",
      status: "success",
      metrics: { tenants: tenants.length, coupons_created: totalCoupons, suggestions: totalSuggestions, emails_sent: totalEmails },
    });

    return new Response(JSON.stringify({ ok: true, tenants: tenants.length, coupons_created: totalCoupons, suggestions: totalSuggestions, emails_sent: totalEmails }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("abandoned-cart-cron error", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
