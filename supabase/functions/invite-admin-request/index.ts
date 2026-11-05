import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

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

  // Claim the approved request before the external email send to prevent duplicate invitations.
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
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(request.email, {
    redirectTo: redirectTo.toString(),
    data: { tenant_id: request.tenant_id, tenant_slug: tenant.slug, role: "admin" },
  });
  if (inviteError || !inviteData.user) {
    console.error("[invite-admin-request] invitation failed", inviteError?.message || "missing user result");
    await admin.from("role_requests").update({ status: "approved" }).eq("id", request.id).eq("status", "inviting");
    return json({ error: "invite_send_failed", detail: "Não foi possível enviar o convite. Verifique a configuração de e-mail ou se já existe uma conta para esse endereço." }, 502);
  }

  const { error: roleError } = await admin.from("user_roles").upsert({
    user_id: inviteData.user.id,
    tenant_id: request.tenant_id,
    role: "admin",
    approved: true,
    email: request.email,
  }, { onConflict: "user_id,tenant_id,role" });
  if (roleError) {
    console.error("[invite-admin-request] role link failed", roleError.message);
    await admin.auth.admin.deleteUser(inviteData.user.id).catch(() => ({ error: null }));
    await admin.from("role_requests").update({ status: "approved" }).eq("id", request.id).eq("status", "inviting");
    return json({ error: "role_link_failed", detail: "Convite não concluído porque não foi possível vincular o acesso à loja." }, 500);
  }

  const { error: finishError } = await admin.from("role_requests")
    .update({ status: "invited" })
    .eq("id", request.id)
    .eq("status", "inviting");
  if (finishError) console.error("[invite-admin-request] could not mark request invited", finishError.message);

  return json({ ok: true, email: request.email, tenantSlug: tenant.slug, status: "invited" });
});
