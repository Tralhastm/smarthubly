// Autorização padrão da plataforma: super admin OU admin de tenant.
// Retorna { isSuperAdmin: boolean; tenantId: string | null; tenantIds: string[] }
// e o caller autorizado — usado pelas EFs de prospecção para liberar acesso
// a lojistas mantendo isolamento multi-tenant.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type CallerAuth = {
  isSuperAdmin: boolean;
  tenantId: string | null;
  tenantIds: string[];
};

export async function authorizeCaller(supabase: SupabaseClient, userId: string): Promise<CallerAuth | { error: string; status: number }> {
  const { data: superRow } = await supabase
    .from("platform_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (superRow) {
    return { isSuperAdmin: true, tenantId: null, tenantIds: [] };
  }

  // Admin de tenant(s): user_roles com approved = true e role admin
  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .eq("approved", true);
  if (error) return { error: `auth_query: ${error.message}`, status: 500 };
  const tenantIds = (roles ?? []).map((r: any) => r.tenant_id).filter(Boolean);
  if (tenantIds.length === 0) {
    return { error: "forbidden", status: 403 };
  }
  return {
    isSuperAdmin: false,
    tenantId: tenantIds[0],
    tenantIds,
  };
}

// Valida que o lead (prospect) pertence ao caller:
// super admin → qualquer lead; lojista → lead do próprio tenant (ou sem tenant
// antigo = leads globais criados antes da migração ficam visíveis pro super admin
// e inacessíveis a lojistas).
export function assertProspectAccess(
  auth: CallerAuth,
  prospect: { tenant_id?: string | null },
): { ok: true } | { error: string; status: number } {
  if (auth.isSuperAdmin) return { ok: true };
  if (prospect.tenant_id === auth.tenantId) return { ok: true };
  return { error: "forbidden", status: 403 };
}
