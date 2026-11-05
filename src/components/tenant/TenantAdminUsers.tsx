import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, XCircle, Clock, Shield, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';

type UserRole = { id: string; user_id: string; role: string; approved: boolean; email: string | null };
type RoleRequest = { id: string; email: string; tenant_id: string; status: string; created_at: string | null };

const TenantAdminUsers = ({ tenantId }: { tenantId: string }) => {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-users', tenantId],
    queryFn: async () => {
      const [rolesResult, requestsResult] = await Promise.all([
        supabase.from('user_roles').select('*').eq('tenant_id', tenantId).order('approved', { ascending: true }),
        supabase.from('role_requests')
          .select('id,email,tenant_id,status,created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false }),
      ]);
      if (rolesResult.error) throw rolesResult.error;
      if (requestsResult.error) throw requestsResult.error;
      return {
        roles: (rolesResult.data || []) as UserRole[],
        requests: (requestsResult.data || []) as RoleRequest[],
      };
    },
  });

  const approveRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_roles').update({ approved: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users', tenantId] }),
  });

  const rejectRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_roles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users', tenantId] }),
  });

  const updateRequest = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase.from('role_requests')
        .update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users', tenantId] }),
  });

  const sendInvite = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.functions.invoke('invite-admin-request', { body: { requestId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail || data.error);
      return data as { email: string };
    },
    onSuccess: (result) => {
      toast.success(`Convite enviado para ${result.email}`);
      qc.invalidateQueries({ queryKey: ['admin-users', tenantId] });
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível enviar o convite.'),
  });

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (isError) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não foi possível carregar as solicitações de acesso. Tente atualizar a página.</p>;

  const roles = data?.roles || [];
  const requests = data?.requests || [];
  const pendingRoles = roles.filter(r => !r.approved);
  const approvedRoles = roles.filter(r => r.approved);
  const pendingRequests = requests.filter(r => r.status === 'pending');
  const approvedRequests = requests.filter(r => r.status === 'approved');
  const invitedRequests = requests.filter(r => r.status === 'invited');
  const invitingRequests = requests.filter(r => r.status === 'inviting');

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="mb-1 flex items-center gap-2 font-heading text-lg text-foreground">
            <Mail className="h-5 w-5 text-warning" /> Pedidos de cadastro ({pendingRequests.length})
          </h3>
          <p className="text-xs text-muted-foreground">Solicitações por e-mail feitas na tela de acesso administrativo.</p>
        </div>
        {pendingRequests.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pedido de cadastro pendente.</p>}
        {pendingRequests.map(request => (
          <div key={request.id} className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{request.email}</p>
              <p className="text-xs text-muted-foreground">Pedido recebido em {request.created_at ? new Date(request.created_at).toLocaleString('pt-BR') : 'data não informada'}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">A aprovação registra o pedido; o acesso exige uma conta vinculada ao mesmo e-mail.</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => updateRequest.mutate({ id: request.id, status: 'approved' })} disabled={updateRequest.isPending} className="flex items-center gap-1 rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-600/30 disabled:opacity-50">
                <CheckCircle className="h-3.5 w-3.5" /> Aprovar
              </button>
              <button onClick={() => updateRequest.mutate({ id: request.id, status: 'rejected' })} disabled={updateRequest.isPending} className="flex items-center gap-1 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 disabled:opacity-50">
                <XCircle className="h-3.5 w-3.5" /> Rejeitar
              </button>
            </div>
          </div>
        ))}
        {(approvedRequests.length > 0 || invitedRequests.length > 0 || invitingRequests.length > 0) && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h4 className="mb-2 text-sm font-medium text-foreground">Pedidos aprovados e convites ({approvedRequests.length + invitedRequests.length + invitingRequests.length})</h4>
            {[...approvedRequests, ...invitingRequests, ...invitedRequests].map(request => (
              <div key={request.id} className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-0">
                <div className="min-w-0"><p className="truncate text-sm text-foreground">{request.email}</p><p className="text-xs text-muted-foreground">{request.status === 'invited' ? 'Convite enviado' : request.status === 'inviting' ? 'Enviando convite…' : 'Aprovado · aguardando envio do convite'}</p></div>
                {request.status === 'approved' && <button onClick={() => { if (window.confirm(`Enviar convite administrativo para ${request.email} na loja?`)) sendInvite.mutate(request.id); }} disabled={sendInvite.isPending} className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Enviar convite</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-lg text-foreground">
          <Clock className="h-5 w-5 text-warning" /> Acessos aguardando aprovação ({pendingRoles.length})
        </h3>
        {pendingRoles.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma solicitação vinculada a uma conta.</p>}
        {pendingRoles.map(role => (
          <div key={role.id} className="mb-2 flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div>
              <p className="text-sm font-medium text-foreground">{role.email || role.user_id.slice(0, 8) + '...'}</p>
              <p className="text-xs text-muted-foreground">Solicitou acesso como {role.role}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => approveRole.mutate(role.id)} className="flex items-center gap-1 rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-600/30"><CheckCircle className="h-3.5 w-3.5" /> Aprovar</button>
              <button onClick={() => rejectRole.mutate(role.id)} className="flex items-center gap-1 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30"><XCircle className="h-3.5 w-3.5" /> Rejeitar</button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-lg text-foreground">
          <Shield className="h-5 w-5 text-primary" /> Acessos aprovados ({approvedRoles.length})
        </h3>
        {approvedRoles.map(role => (
          <div key={role.id} className="mb-2 flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div>
              <p className="text-sm font-medium text-foreground">{role.email || role.user_id.slice(0, 8) + '...'}</p>
              <p className="text-xs text-muted-foreground">{role.role} · Aprovado</p>
            </div>
            <button onClick={() => rejectRole.mutate(role.id)} className="ml-2 flex shrink-0 items-center gap-1 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30"><XCircle className="h-3.5 w-3.5" /> Remover</button>
          </div>
        ))}
      </section>
    </div>
  );
};

export default TenantAdminUsers;
