import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, XCircle, Clock, Shield } from 'lucide-react';

type UserRole = { id: string; user_id: string; role: string; approved: boolean; email: string | null; };

const TenantAdminUsers = ({ tenantId }: { tenantId: string }) => {
  const qc = useQueryClient();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['admin-users', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('approved', { ascending: true });
      if (error) throw error;
      return data as UserRole[];
    },
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_roles').update({ approved: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users', tenantId] }),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_roles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users', tenantId] }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const pending = roles.filter(r => !r.approved);
  const approved = roles.filter(r => r.approved);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-lg text-foreground flex items-center gap-2 mb-3">
          <Clock className="h-5 w-5 text-warning" /> Aguardando ({pending.length})
        </h3>
        {pending.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma solicitação.</p>}
        {pending.map(r => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-4 mb-2">
            <div>
              <p className="text-sm font-medium text-foreground">{r.email || r.user_id.slice(0, 8) + '...'}</p>
              <p className="text-xs text-muted-foreground">Solicitou acesso como {r.role}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => approve.mutate(r.id)} className="flex items-center gap-1 rounded-lg bg-green-600/20 text-green-400 px-3 py-1.5 text-xs font-medium hover:bg-green-600/30">
                <CheckCircle className="h-3.5 w-3.5" /> Aprovar
              </button>
              <button onClick={() => reject.mutate(r.id)} className="flex items-center gap-1 rounded-lg bg-red-600/20 text-red-400 px-3 py-1.5 text-xs font-medium hover:bg-red-600/30">
                <XCircle className="h-3.5 w-3.5" /> Rejeitar
              </button>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-heading text-lg text-foreground flex items-center gap-2 mb-3">
          <Shield className="h-5 w-5 text-primary" /> Aprovados ({approved.length})
        </h3>
        {approved.map(r => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-4 mb-2">
            <div>
              <p className="text-sm font-medium text-foreground">{r.email || r.user_id.slice(0, 8) + '...'}</p>
              <p className="text-xs text-muted-foreground">{r.role} · Aprovado</p>
            </div>
            <button onClick={() => reject.mutate(r.id)} className="flex items-center gap-1 rounded-lg bg-red-600/20 text-red-400 px-3 py-1.5 text-xs font-medium hover:bg-red-600/30">
              <XCircle className="h-3.5 w-3.5" /> Remover
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TenantAdminUsers;
