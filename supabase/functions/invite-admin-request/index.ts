import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getBrevoApiKey, getBrevoSenderEmail } from "../_shared/brevo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

type LinkPurpose = "invite" | "recovery";
type AdminActionLink = { userId: string; actionLink: string; purpose: LinkPurpose };

type AdminClient = ReturnType<typeof createClient>;

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error || "unknown_error");
}

function isAlreadyRegistered(error: unknown): boolean {
  return /already\s+(?:been\s+)?registered|already exists/i.test(errorMessage(error));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function generateAdminActionLink(
  admin: AdminClient,
  email: string,
  redirectTo: string,
  tenantId: string,
  tenantSlug: string,
): Promise<AdminActionLink> {
  const invite = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo,
      data: { tenant_id: tenantId, tenant_slug: tenantSlug, role: "admin" },
    },
  });

  if (!invite.error && invite.data?.user?.id && invite.data?.properties?.action_link) {
    return {
      userId: invite.data.user.id,
      actionLink: invite.data.properties.action_link,
      purpose: "invite",
    };
  }

  if (invite.error && isAlreadyRegistered(invite.error)) {
    const recovery = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (recovery.error || !recovery.data?.user?.id || !recovery.data?.properties?.action_link) {
      throw new Error(`recovery_link_failed: ${errorMessage(recovery.error || "missing_link_data")}`);
    }
    return {
      userId: recovery.data.user.id,
      actionLink: recovery.data.properties.action_link,
      purpose: "recovery",
    };
  }

  throw new Error(`invite_link_failed: ${errorMessage(invite.error || "missing_link_data")}`);
}

async function sendAdminAccessEmail(
  admin: AdminClient,
  email: string,
  tenantName: string,
  actionLink: string,
): Promise<void> {
  const apiKey = await getBrevoApiKey(admin);
  if (!apiKey) throw new Error("Missing Brevo API key");

  const safeTenantName = escapeHtml(tenantName);
  const safeActionLink = escapeHtml(actionLink);
  const subject = `Acesso administrativo aprovado — ${tenantName}`;
  const textContent = [
    "Olá,",
    "",
    `Sua solicitação de acesso administrativo à loja ${tenantName} foi aprovada.`,
    "Use este link para ativar seu acesso e criar ou atualizar sua senha:",
    actionLink,
    "",
    "Se você não solicitou esse acesso, ignore esta mensagem.",
    "SmartHubly",
  ].join("\n");
  const htmlContent = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17202a"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:12px"><h1 style="font-size:22px;margin:0 0 20px">Acesso administrativo aprovado</h1><p>Olá,</p><p>Sua solicitação de acesso administrativo à loja <strong>${safeTenantName}</strong> foi aprovada.</p><p>Use o botão abaixo para ativar seu acesso e criar ou atualizar sua senha.</p><p style="margin:28px 0"><a href="${safeActionLink}" style="display:inline-block;padding:13px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Ativar acesso e definir senha</a></p><p style="font-size:13px;color:#5b6573">Se o botão não funcionar, copie este endereço para o navegador:<br><a href="${safeActionLink}">${safeActionLink}</a></p><p style="font-size:13px;color:#5b6573">Se você não solicitou esse acesso, ignore esta mensagem.</p><p>SmartHubly</p></div></body></html>`;

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      sender: { name: "SmartHubly", email: getBrevoSenderEmail() },
      to: [{ email }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!response.ok) {
    console.error("[invite-admin-request] Brevo rejected the message", { status: response.status });
    throw new Error(`Brevo returned HTTP ${response.status}`);
  }
}

async function restoreApprovedStatus(admin: AdminClient, requestId: string): Promise<void> {
  const { error } = await admin.from("role_requests")
    .update({ status: "approved" })
    .eq("id", requestId)
    .eq("status", "inviting");
  if (error) console.error("[invite-admin-request] could not restore approved status", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "server_configuration_error" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "authentication_required" }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "authentication_required" }, 401);

  const body = await req.json().catch(() => ({}));
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  if (!requestId || requestId.length > 100) return json({ error: "invalid_request_id" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: request, error: requestError } = await admin.from("role_requests")
    .select("id,email,tenant_id,status")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError || !request) return json({ error: "request_not_found" }, 404);
  if (request.status === "invited") return json({ ok: true, alreadyInvited: true });
  if (request.status !== "approved") return json({ error: "request_must_be_approved_first" }, 409);

  const [{ data: platformRole }, { data: tenantRole }, { data: tenant }] = await Promise.all([
    admin.from("platform_roles").select("role").eq("user_id", authData.user.id).eq("role", "super_admin").maybeSingle(),
    admin.from("user_roles").select("id").eq("user_id", authData.user.id).eq("tenant_id", request.tenant_id).eq("role", "admin").eq("approved", true).maybeSingle(),
    admin.from("tenants").select("slug,name").eq("id", request.tenant_id).maybeSingle(),
  ]);
  if (!platformRole && !tenantRole) return json({ error: "not_authorized_for_tenant" }, 403);
  if (!tenant?.slug) return json({ error: "tenant_not_found" }, 404);

  const { data: claimed, error: claimError } = await admin.from("role_requests")
    .update({ status: "inviting" })
    .eq("id", request.id)
    .eq("status", "approved")
    .select("id")
    .maybeSingle();
  if (claimError) return json({ error: "could_not_claim_request" }, 500);
  if (!claimed) return json({ error: "request_is_being_processed" }, 409);

  const redirectTo = new URL("https://smarthubly.pages.dev/ativar-admin");
  redirectTo.searchParams.set("tenant", tenant.slug);
  const email = String(request.email || "").trim();
  let actionLink: AdminActionLink;
  try {
    actionLink = await generateAdminActionLink(admin, email, redirectTo.toString(), request.tenant_id, tenant.slug);
  } catch (error) {
    console.error("[invite-admin-request] could not generate Auth link", errorMessage(error));
    await restoreApprovedStatus(admin, request.id);
    return json({ error: "auth_link_generation_failed", detail: "Não foi possível preparar o link de acesso. A solicitação continua aprovada para nova tentativa." }, 502);
  }

  const { error: roleError } = await admin.from("user_roles").upsert({
    user_id: actionLink.userId,
    tenant_id: request.tenant_id,
    role: "admin",
    approved: true,
    email,
  }, { onConflict: "user_id,tenant_id,role" });
  if (roleError) {
    console.error("[invite-admin-request] role link failed", roleError.message);
    if (actionLink.purpose === "invite") await admin.auth.admin.deleteUser(actionLink.userId).catch(() => ({ error: null }));
    await restoreApprovedStatus(admin, request.id);
    return json({ error: "role_link_failed", detail: "Convite não concluído porque não foi possível vincular o acesso à loja." }, 500);
  }

  try {
    await sendAdminAccessEmail(admin, email, tenant.name || tenant.slug, actionLink.actionLink);
  } catch (error) {
    console.error("[invite-admin-request] Brevo delivery failed", errorMessage(error));
    await restoreApprovedStatus(admin, request.id);
    return json({ error: "brevo_delivery_failed", detail: "A Brevo não aceitou o e-mail. A solicitação continua aprovada para nova tentativa." }, 502);
  }

  const { error: finishError } = await admin.from("role_requests")
    .update({ status: "invited" })
    .eq("id", request.id)
    .eq("status", "inviting");
  if (finishError) console.error("[invite-admin-request] could not mark request invited", finishError.message);

  return json({ ok: true, email, tenantSlug: tenant.slug, status: "invited", deliveryProvider: "brevo" });
});
