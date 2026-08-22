// Helpers de autenticação para edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
export async function getAuthUser(req) {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.replace("Bearer ", "");
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"));
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch  {
    return null;
  }
}
export async function isTenantAdmin(adminClient, userId, tenantId) {
  const { data } = await adminClient.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId).eq("role", "admin").eq("approved", true).maybeSingle();
  if (data) return true;
  // Super admin override
  const { data: sa } = await adminClient.from("platform_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  return !!sa;
}
export async function isSuperAdmin(adminClient, userId) {
  const { data } = await adminClient.from("platform_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  return !!data;
}
