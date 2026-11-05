import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, XCircle, Clock, Shield, Store, Mail } from 'lucide-react';

type UserRoleRow = {
  id: string;
  user_id: string;
  tenant_id: string;
  role: string;
  approved: boolean;
  email: string | null;
  created_at: string;
  tenant_name?: string;
  tenant_slug?: string;
};
type RoleRequestRow = {
  id: string;
  email: string;
  tenant_id: string;
  status: string;
  created_at: string;
  tenant_name?: string;
  tenant_slug?: string;
};

const SuperAdminUsers = () => {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['super-admin-user-roles'],
    queryFn: async () => {
      const [rolesResult, requestsResult] = await Promise.all([
        supabase.from('user_roles').select('*, tenants(name, slug)').order('approved', { ascending: true }).order('created_at', { ascending: false }),
        (supabase.from('role_requests' as any) as any)
          .select('id,email,tenant_id,status,created_at')
          .order('created_at', { ascending: false })
          .limit(500),
      ]);
      if (rolesResult.error) throw rolesResult.error;
      if (requestsResult.error) throw requestsResult.error;

      const requests = (requestsResult.data || []) as RoleRequestRow[];
      const tenantIds = [...new Set(requests.map(request => request.tenant_id).filter(Boolean))];
      const tenantNames = new Map<string, { name: string; slug: string }>();
      if (tenantIds.length) {
        const { data: tenants, error: tenantsError } = await supabase.from('tenants').select('id,name,slug').in('id', tenantIds);
        if (tenantsError) throw tenantsError;
        (tenants || []).forEach((tenant: any) => tenantNames.set(tenant.id, { name: tenant.name, slug: tenant.slug }));
      }

      return {
        roles: (rolesResult.data || []).map((role: any) => ({
          ...role,
          tenant_name: role.tenants?.name || '—',
          tenant_slug: role.tenants?.slug || '',
        })) as UserRoleRow[],
        requests: requests.map(request => ({
          ...request,
          tenant_name: tenantNames.get(request.tenant_id)?.name || '—',
          tenant_slug: tenantNames.get(request.tenant_id)?.slug || '',
        })),
      };
    },
  });

  const approveRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_roles').update({ approved: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin-user-roles'] }),
  });

  const rejectRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_roles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin-user-roles'] }),
  });

  const updateRequest = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      const { error } = await (supabase.from('role_requests' as any) as any).update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin-user-roles'] }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (isError) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não foi possível carregar os usuários e solicitações de cadastro.</p>;

  const roles = data?.roles || [];
  const requests = data?.requests || [];
  const pendingRequests = requests.filter(request => request.status === 'pending');
  const approvedRequests = requests.filter(request => request.status === 'approved');
  const pending = roles.filter(role => !role.approved);
  const approved = roles.filter(role => role.approved);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-lg text-foreground">
          <Mail className="h-5 w-5 text-warning" /> Pedidos de cadastro pendentes ({pendingRequests.length})
        </h3>
        {pendingRequests.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pedido de cadastro pendente.</p>}
        {pendingRequests.map(request => (
          <div key={request.id} className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{request.email}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><Store className="h-3 w-3" /> {request.tenant_name} <span className="text-muted-foreground/60">/{request.tenant_slug}</span></p>
              <p className="text-[11px] text-muted-foreground">Recebido em {new Date(request.created_at).toLocaleString('pt-BR')} · a aprovação registra o pedido, mas não cria a conta de login.</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => updateRequest.mutate({ id: request.id, status: 'approved' })} disabled={updateRequest.isPending} className="flex items-center gap-1 rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-600/30 disabled:opacity-50"><CheckCircle className="h-3.5 w-3.5" /> Aprovar</button>
              <button onClick={() => updateRequest.mutate({ id: request.id, status: 'rejected' })} disabled={updateRequest.isPending} className="flex items-center gap-1 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" /> Negar</button>
            </div>
          </div>
        ))}
        {approvedRequests.length > 0 && <p className="text-xs text-muted-foreground">Pedidos já aprovados: {approvedRequests.length}</p>}
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-lg text-foreground"><Clock className="h-5 w-5 text-warning" /> Aguardando aprovação de conta ({pending.length})</h3>
        {pending.length === 0 && <p className="text-sm text-muted-foreground">Nenhum acesso vinculado a conta pendente.</p>}
        {pending.map(role => (
          <div key={role.id} className="mb-2 flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{role.email || role.user_id.slice(0, 8) + '...'}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Store className="h-3 w-3" /> {role.tenant_name} <span className="text-muted-foreground/60">/{role.tenant_slug}</span></p><p className="text-xs text-muted-foreground">Solicitou: {role.role}</p></div>
            <div className="ml-2 flex shrink-0 gap-2"><button onClick={() => approveRole.mutate(role.id)} className="flex items-center gap-1 rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-600/30"><CheckCircle className="h-3.5 w-3.5" /> Aprovar</button><button onClick={() => rejectRole.mutate(role.id)} className="flex items-center gap-1 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30"><XCircle className="h-3.5 w-3.5" /> Negar</button></div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-lg text-foreground"><Shield className="h-5 w-5 text-primary" /> Aprovados ({approved.length})</h3>
        {approved.length === 0 && <p className="text-sm text-muted-foreground">Nenhum usuário aprovado.</p>}
        {approved.map(role => (
          <div key={role.id} className="mb-2 flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{role.email || role.user_id.slice(0, 8) + '...'}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Store className="h-3 w-3" /> {role.tenant_name} · {role.role}</p></div>
            <button onClick={() => rejectRole.mutate(role.id)} className="ml-2 flex shrink-0 items-center gap-1 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30"><XCircle className="h-3.5 w-3.5" /> Revogar</button>
          </div>
        ))}
      </section>
    </div>
  );
};

export default SuperAdminUsers;
