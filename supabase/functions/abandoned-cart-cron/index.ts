// #4 Cupom de carrinho abandonado.
// Roda a cada 30 min. Gera cupom/sugestão uma única vez e mantém tentativas de e-mail
// separadas do alerta manual por WhatsApp. E-mail exige consentimento promocional explícito.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getBrevoApiKey, getBrevoSenderEmail } from "../_shared/brevo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char] as string));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const failures: string[] = [];
  let tenantsProcessed = 0;
  let couponsCreated = 0;
  let suggestionsCreated = 0;
  let emailsSent = 0;
  let brevoApiKey: string | null = null;
  let brevoKeyLoaded = false;

  const addFailure = (scope: string, error: unknown) => {
    failures.push(`${scope}: ${errorText(error)}`);
  };

  try {
    const { data: tenants, error: tenantsError } = await supa.from("tenants")
      .select("id, name, store_mode, active, marketing_emails_enabled, abandoned_cart_email_enabled, brevo_sender_email, brevo_sender_name")
      .eq("active", true)
      .eq("auto_abandon_coupon", true)
      .neq("store_mode", "affiliate");
    if (tenantsError) throw new Error(`Falha ao consultar lojas: ${tenantsError.message}`);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    for (const tenant of tenants || []) {
      tenantsProcessed++;
      const { data: carts, error: cartsError } = await supa.from("cart_sessions")
        .select("id, customer_phone, customer_name, customer_email, marketing_email_opt_in, abandoned_email_sent_at, items, total, last_activity_at, abandoned_notified_at, coupon_code")
        .eq("tenant_id", tenant.id)
        .is("converted_order_id", null)
        .lte("last_activity_at", oneHourAgo)
        .gte("last_activity_at", oneDayAgo)
        .gt("total", 0)
        .order("last_activity_at", { ascending: true })
        .limit(50);

      if (cartsError) {
        addFailure(`Carrinhos da loja ${tenant.id}`, cartsError);
        continue;
      }

      for (const cart of carts || []) {
        let couponCode = cart.coupon_code || null;

        // Recupera uma tentativa parcialmente concluída em vez de criar outro cupom.
        if (!cart.abandoned_notified_at) {
          const { data: existing, error: existingError } = await supa.from("automation_suggestions")
            .select("id, payload")
            .eq("tenant_id", tenant.id)
            .eq("type", "abandoned_cart")
            .contains("payload", { cart_id: cart.id })
            .limit(1);
          if (existingError) {
            addFailure(`Verificação do carrinho ${cart.id}`, existingError);
            continue;
          }

          if (existing?.length) {
            const priorPayload = existing[0].payload as Record<string, unknown> | null;
            couponCode = String(priorPayload?.coupon_code || couponCode || "") || null;
          } else {
            if (!couponCode) {
              couponCode = `VOLTA${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
              const { error: couponError } = await supa.from("coupons").insert({
                tenant_id: tenant.id,
                code: couponCode,
                discount_type: "percent",
                discount_value: 10,
                min_order_value: 0,
                max_uses: 1,
                active: true,
                expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
              });
              if (couponError) {
                addFailure(`Cupom do carrinho ${cart.id}`, couponError);
                continue;
              }
            }

            const { error: suggestionError } = await supa.from("automation_suggestions").insert({
              tenant_id: tenant.id,
              type: "abandoned_cart",
              title: `Carrinho abandonado: ${cart.customer_name || cart.customer_phone}`,
              description: `R$ ${Number(cart.total).toFixed(2)} no carrinho. Cupom ${couponCode} (10% off, válido 7 dias) gerado. Envie a mensagem pelo WhatsApp para ${cart.customer_phone}.`,
              payload: { cart_id: cart.id, phone: cart.customer_phone, name: cart.customer_name, total: cart.total, coupon_code: couponCode },
              status: "pending",
            });

            if (suggestionError) {
              // Se outra execução venceu a corrida da chave única, reutilize a sugestão dela.
              if (suggestionError.code === "23505") {
                const { data: raced, error: racedError } = await supa.from("automation_suggestions")
                  .select("id, payload")
                  .eq("tenant_id", tenant.id)
                  .eq("type", "abandoned_cart")
                  .contains("payload", { cart_id: cart.id })
                  .limit(1);
                if (racedError || !raced?.length) {
                  if (couponCode && !cart.coupon_code) {
                    await supa.from("coupons").update({ active: false }).eq("tenant_id", tenant.id).eq("code", couponCode);
                  }
                  addFailure(`Sugestão do carrinho ${cart.id}`, racedError || suggestionError);
                  continue;
                }
                const racedPayload = raced[0].payload as Record<string, unknown> | null;
                const racedCoupon = String(racedPayload?.coupon_code || "") || null;
                if (couponCode && couponCode !== racedCoupon && !cart.coupon_code) {
                  const { error: deactivateError } = await supa.from("coupons").update({ active: false })
                    .eq("tenant_id", tenant.id).eq("code", couponCode);
                  if (deactivateError) addFailure(`Desativação do cupom concorrente ${cart.id}`, deactivateError);
                }
                couponCode = racedCoupon || cart.coupon_code || null;
              } else {
                if (couponCode && !cart.coupon_code) {
                  const { error: deactivateError } = await supa.from("coupons").update({ active: false })
                    .eq("tenant_id", tenant.id).eq("code", couponCode);
                  if (deactivateError) addFailure(`Desativação do cupom ${cart.id}`, deactivateError);
                }
                addFailure(`Sugestão do carrinho ${cart.id}`, suggestionError);
                continue;
              }
            } else {
              couponsCreated += cart.coupon_code ? 0 : 1;
              suggestionsCreated++;
            }
          }

          if (!couponCode) {
            addFailure(`Recuperação do carrinho ${cart.id}`, "A sugestão existente não contém um cupom reutilizável.");
            continue;
          }

          const { error: markError } = await supa.from("cart_sessions")
            .update({ coupon_code: couponCode, abandoned_notified_at: new Date().toISOString() })
            .eq("id", cart.id);
          if (markError) {
            addFailure(`Marcação do carrinho ${cart.id}`, markError);
            continue;
          }
        }

        // O e-mail é um canal independente: só envia com opt-in explícito, flags da loja,
        // e sem descadastro. Falha transitória fica registrada e pode ser tentada novamente.
        const customerEmail = String(cart.customer_email || "").trim();
        const canEmail = Boolean(
          cart.marketing_email_opt_in === true
          && customerEmail
          && tenant.marketing_emails_enabled === true
          && tenant.abandoned_cart_email_enabled === true
          && !cart.abandoned_email_sent_at
          && couponCode,
        );
        if (!canEmail) continue;

        const { data: unsubscribed, error: unsubscribeError } = await supa.from("email_unsubscribes")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("email", customerEmail.toLowerCase())
          .maybeSingle();
        if (unsubscribeError) {
          addFailure(`Verificação de descadastro ${cart.id}`, unsubscribeError);
          continue;
        }
        if (unsubscribed) continue;

        if (!brevoKeyLoaded) {
          brevoKeyLoaded = true;
          try { brevoApiKey = await getBrevoApiKey(supa); }
          catch (e) { addFailure("Credencial Brevo", e); }
        }
        if (!brevoApiKey) {
          addFailure(`E-mail do carrinho ${cart.id}`, "A chave Brevo não está configurada.");
          continue;
        }

        const customerName = escapeHtml(cart.customer_name || "");
        const tenantName = escapeHtml(tenant.name);
        const safeCode = escapeHtml(couponCode);
        const unsubUrl = `${SUPABASE_URL}/functions/v1/notify-unified/unsubscribe-public?tenant=${tenant.id}&email=${encodeURIComponent(customerEmail)}`;
        const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
          <h1 style="color:#3b82f6">Esqueceu algo${customerName ? `, ${customerName}` : ""}? 🛒</h1>
          <p>Você deixou itens no carrinho da <b>${tenantName}</b>. Use seu cupom de <b>10% OFF</b> se quiser concluir a compra.</p>
          <div style="background:#f3f4f6;padding:16px;border-radius:8px;text-align:center;margin:20px 0">
            <div style="color:#6b7280;font-size:12px">CUPOM</div>
            <div style="font-size:28px;font-weight:700;color:#10b981;letter-spacing:2px">${safeCode}</div>
            <div style="color:#6b7280;font-size:12px">Válido por 7 dias</div>
          </div>
          <hr style="margin-top:24px;border:none;border-top:1px solid #eee"/>
          <p style="color:#999;font-size:11px;text-align:center"><a href="${unsubUrl}" style="color:#999">Não quero mais receber estes e-mails</a></p>
        </div>`;

        try {
          const response = await fetch(BREVO_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
            body: JSON.stringify({
              sender: {
                name: tenant.brevo_sender_name || tenant.name,
                email: tenant.brevo_sender_email || getBrevoSenderEmail(),
              },
              to: [{ email: customerEmail, name: cart.customer_name || "" }],
              subject: `🛒 Esqueceu algo? ${couponCode} = 10% OFF na ${tenant.name}`,
              htmlContent: html,
            }),
          });
          if (!response.ok) {
            addFailure(`Brevo ${cart.id}`, `HTTP ${response.status}`);
            continue;
          }
          const { error: sentMarkError } = await supa.from("cart_sessions")
            .update({ abandoned_email_sent_at: new Date().toISOString() })
            .eq("id", cart.id)
            .is("abandoned_email_sent_at", null);
          if (sentMarkError) {
            addFailure(`Registro de e-mail enviado ${cart.id}`, sentMarkError);
            continue;
          }
          emailsSent++;
        } catch (e) {
          addFailure(`Envio Brevo ${cart.id}`, e);
        }
      }
    }

    const metrics = {
      tenants: tenants?.length || 0,
      coupons_created: couponsCreated,
      suggestions_created: suggestionsCreated,
      emails_sent: emailsSent,
      failures: failures.length,
    };
    const { error: runError } = await supa.from("automation_runs").insert({
      automation_type: "abandoned_cart_cron",
      status: failures.length ? "error" : "success",
      metrics,
      error_message: failures.length ? failures.slice(0, 10).join("; ") : null,
    });
    if (runError) throw new Error(`Falha ao registrar execução: ${runError.message}`);

    return new Response(JSON.stringify({ ok: failures.length === 0, ...metrics, tenants_processed: tenantsProcessed }), {
      status: failures.length ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = errorText(e);
    console.error("abandoned-cart-cron error", message);
    const { error: logError } = await supa.from("automation_runs").insert({
      automation_type: "abandoned_cart_cron",
      status: "error",
      metrics: { tenants: tenantsProcessed, coupons_created: couponsCreated, suggestions_created: suggestionsCreated, emails_sent: emailsSent },
      error_message: message,
    });
    if (logError) console.error("abandoned-cart-cron run log failed", logError.message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
