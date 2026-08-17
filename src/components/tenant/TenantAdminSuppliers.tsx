import { useState } from 'react';
import { useSuppliers, useAddSupplier, useDeleteSupplier, useUpdateSupplier, useUpdateSupplierStoreApiStatus, type Supplier } from '@/hooks/useSuppliers';
import { Plus, Trash2, Copy, Truck, MapPin, Check, CheckCircle, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

const TenantAdminSuppliers = ({ tenantId, slug }: { tenantId: string; slug: string }) => {
  const { data: suppliers = [], isLoading } = useSuppliers(tenantId);
  const addSupplier = useAddSupplier();
  const deleteSupplier = useDeleteSupplier(tenantId);
  const updateSupplier = useUpdateSupplier();
  const updateApiStatus = useUpdateSupplierStoreApiStatus();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [responsible, setResponsible] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    await addSupplier.mutateAsync({ tenant_id: tenantId, name, address, phone, responsible_for_delivery: responsible });
    setName(''); setAddress(''); setPhone(''); setResponsible(false);
    toast.success('Fornecedor cadastrado!');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Remover fornecedor?')) return;
    deleteSupplier.mutate(id);
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/loja/${slug}/fornecedor/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiado!');
  };

  const toggleDelivery = (s: Supplier) => {
    updateSupplier.mutate({ ...s, responsible_for_delivery: !s.responsible_for_delivery });
  };

  const handleApiAction = async (supplierId: string, status: 'approved' | 'revoked' | 'none') => {
    const labels = { approved: 'aprovar', revoked: 'revogar', none: 'limpar solicitação de' };
    if (!confirm(`Tem certeza que deseja ${labels[status]} o uso da API Lalamove da loja por este fornecedor?`)) return;
    await updateApiStatus.mutateAsync({ supplierId, status, tenantId });
    toast.success(status === 'approved' ? 'Acesso aprovado!' : status === 'revoked' ? 'Acesso revogado.' : 'Solicitação removida.');
  };

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const pendingCount = suppliers.filter(s => s.lalamove_use_store_api === 'pending').length;

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-foreground">Novo Fornecedor</h3>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Endereço (base do frete)" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Telefone" className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={responsible} onChange={e => setResponsible(e.target.checked)} className="rounded border-border" />
          <Truck className="h-4 w-4" /> Responsável pela entrega (endereço vira base do frete)
        </label>
        <button type="submit" disabled={addSupplier.isPending} className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Cadastrar
        </button>
      </form>

      {pendingCount > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span><strong>{pendingCount}</strong> {pendingCount === 1 ? 'fornecedor solicitou' : 'fornecedores solicitaram'} acesso à API Lalamove da loja.</span>
        </div>
      )}

      {suppliers.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum fornecedor cadastrado.</p>}

      {suppliers.map(s => {
        const apiStatus = s.lalamove_use_store_api || 'none';
        const hasOwn = !!(s.lalamove_api_key && s.lalamove_api_secret);
        return (
          <div key={s.id} className="rounded-lg border border-border bg-card p-4 space-y-3 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground break-words">{s.name}</p>
                {s.phone && <p className="text-xs text-muted-foreground mt-0.5 break-all">📞 {s.phone}</p>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => copyLink(s.access_token)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Copy className="h-3 w-3" /> <span className="hidden xs:inline">Link do </span>Painel
                </button>
                <button onClick={() => handleDelete(s.id)} aria-label="Remover" className="text-destructive hover:text-destructive/80">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {s.address && <p className="flex items-start gap-1 text-xs text-muted-foreground break-words"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span className="min-w-0 break-words">{s.address}</span></p>}
            <button onClick={() => toggleDelivery(s)} className={`flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ${s.responsible_for_delivery ? 'bg-green-500/20 text-green-400' : 'bg-secondary text-muted-foreground'}`}>
              {s.responsible_for_delivery ? <Check className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
              {s.responsible_for_delivery ? 'Responsável pela entrega' : 'Não entrega'}
            </button>

            {/* Bloco Lalamove */}
            <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
              <p className="text-xs font-medium text-foreground flex items-center gap-1">
                <Truck className="h-3 w-3 text-orange-400" /> Lalamove
              </p>

              {hasOwn && (
                <p className="text-xs text-green-400 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> Fornecedor tem API própria (ele paga as corridas)
                </p>
              )}

              {!hasOwn && apiStatus === 'none' && (
                <p className="text-xs text-muted-foreground">Não solicitou acesso à API da loja.</p>
              )}

              {apiStatus === 'pending' && (
                <div className="space-y-2">
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Solicitou acesso à sua API Lalamove (loja pagaria as corridas dele)
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => handleApiAction(s.id, 'approved')}
                      className="flex items-center gap-1 rounded-md bg-green-500/20 text-green-400 px-3 py-1.5 text-xs hover:bg-green-500/30">
                      <CheckCircle className="h-3 w-3" /> Aprovar
                    </button>
                    <button onClick={() => handleApiAction(s.id, 'revoked')}
                      className="flex items-center gap-1 rounded-md bg-red-500/20 text-red-400 px-3 py-1.5 text-xs hover:bg-red-500/30">
                      <XCircle className="h-3 w-3" /> Reprovar
                    </button>
                  </div>
                </div>
              )}

              {apiStatus === 'approved' && (
                <div className="space-y-2">
                  <p className="text-xs text-green-400 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Aprovado para usar a API Lalamove da loja (loja paga)
                  </p>
                  <button onClick={() => handleApiAction(s.id, 'revoked')}
                    className="flex items-center gap-1 rounded-md bg-red-500/20 text-red-400 px-3 py-1.5 text-xs hover:bg-red-500/30">
                    <XCircle className="h-3 w-3" /> Revogar acesso
                  </button>
                </div>
              )}

              {apiStatus === 'revoked' && (
                <div className="space-y-2">
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <XCircle className="h-3 w-3" /> Acesso revogado
                  </p>
                  <button onClick={() => handleApiAction(s.id, 'approved')}
                    className="flex items-center gap-1 rounded-md bg-green-500/20 text-green-400 px-3 py-1.5 text-xs hover:bg-green-500/30">
                    <CheckCircle className="h-3 w-3" /> Re-aprovar
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TenantAdminSuppliers;
