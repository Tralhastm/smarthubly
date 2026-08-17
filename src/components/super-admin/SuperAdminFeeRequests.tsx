import { useState } from 'react';
import { useFeeRequests, useUpdateFeeRequest } from '@/hooks/useFeeRequests';
import { useProducts } from '@/hooks/useProducts';
import { useTenants } from '@/hooks/useTenants';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X, Clock, Percent } from 'lucide-react';
import { toast } from 'sonner';

const SuperAdminFeeRequests = () => {
  const { data: requests = [], isLoading } = useFeeRequests();
  const { data: tenants = [] } = useTenants();
  const updateReq = useUpdateFeeRequest();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>('pending');

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);

  const handleApprove = async (req: typeof requests[0]) => {
    // Update product's platform_fee_percent
    await supabase.from('products').update({ platform_fee_percent: req.requested_percent }).eq('id', req.product_id);
    updateReq.mutate({ id: req.id, status: 'approved' }, {
      onSuccess: () => {
        toast.success('Taxa aprovada e aplicada ao produto!');
        queryClient.invalidateQueries({ queryKey: ['products'] });
      }
    });
  };

  const handleReject = (id: string) => {
    updateReq.mutate({ id, status: 'rejected' }, {
      onSuccess: () => toast.info('Solicitação rejeitada.')
    });
  };

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {['pending', 'approved', 'rejected', 'all'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium transition-all ${filter === s ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            {s === 'pending' ? '⏳ Pendentes' : s === 'approved' ? '✅ Aprovadas' : s === 'rejected' ? '❌ Rejeitadas' : 'Todas'}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhuma solicitação.</p>}

      {filtered.map(req => {
        const tenant = tenants.find(t => t.id === req.tenant_id);
        return <FeeRequestCard key={req.id} req={req} tenantName={tenant?.name || '?'} tenantSlug={tenant?.slug || ''} 
          onApprove={() => handleApprove(req)} onReject={() => handleReject(req.id)} />;
      })}
    </div>
  );
};

const FeeRequestCard = ({ req, tenantName, tenantSlug, onApprove, onReject }: {
  req: { id: string; product_id: string; tenant_id: string; requested_percent: number; status: string; created_at: string };
  tenantName: string; tenantSlug: string;
  onApprove: () => void; onReject: () => void;
}) => {
  const { data: products = [] } = useProducts(req.tenant_id);
  const product = products.find(p => p.id === req.product_id);

  const statusBadge = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    approved: 'bg-green-500/20 text-green-400',
    rejected: 'bg-red-500/20 text-red-400',
  }[req.status] || 'bg-secondary text-muted-foreground';

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Percent className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground text-sm">{tenantName}</span>
          <span className="text-xs text-muted-foreground">/{tenantSlug}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge}`}>
          {req.status === 'pending' ? 'Pendente' : req.status === 'approved' ? 'Aprovada' : 'Rejeitada'}
        </span>
      </div>

      <div className="text-sm text-muted-foreground">
        <p>Produto: <strong className="text-foreground">{product?.name || req.product_id.slice(0, 8)}</strong></p>
        <p>Preço: R${product?.price.toFixed(2) || '?'}</p>
        <p className="text-primary font-medium">Taxa solicitada: {req.requested_percent}%</p>
        {product?.platform_fee_percent != null && (
          <p className="text-xs">Taxa atual: {product.platform_fee_percent}%</p>
        )}
        <p className="text-xs mt-1">{new Date(req.created_at).toLocaleString('pt-BR')}</p>
      </div>

      {req.status === 'pending' && (
        <div className="flex gap-2">
          <button onClick={onApprove} className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-green-600 text-primary-foreground py-2 text-sm font-medium hover:opacity-90">
            <Check className="h-4 w-4" /> Aprovar
          </button>
          <button onClick={onReject} className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-destructive text-destructive-foreground py-2 text-sm font-medium hover:opacity-90">
            <X className="h-4 w-4" /> Rejeitar
          </button>
        </div>
      )}
    </div>
  );
};

export default SuperAdminFeeRequests;
