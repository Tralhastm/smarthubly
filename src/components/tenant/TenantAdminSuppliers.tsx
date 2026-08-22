import { useState, useCallback, useEffect } from 'react';
import { useSuppliers, useAddSupplier, useDeleteSupplier, useUpdateSupplier, useUpdateSupplierStoreApiStatus, type Supplier } from '@/hooks/useSuppliers';
import { Plus, Trash2, Copy, Truck, MapPin, Check, CheckCircle, XCircle, Clock, BarChart3, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

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
    // A rota correta definida no App.tsx é /loja/:slug/fornecedor/:token
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

  // Comparação de preços entre fornecedores (multi-upload)
  const [showCompare, setShowCompare] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  type PriceRowC = { supplier_id: string; product_name: string; unit_price: number; price_types: string[] | null; supplier_name: string };
  const [compareRows, setCompareRows] = useState<PriceRowC[]>([]);

  const loadCompare = useCallback(async () => {
    if (!tenantId) return;
    setCompareLoading(true);
    const { data, error } = await supabase
      .from('supplier_product_prices')
      .select('supplier_id, product_name, unit_price, price_types, suppliers(name)')
      .eq('suppliers.tenant_id', tenantId)
      .not('suppliers.name', 'is', null);
    setCompareLoading(false);
    if (error || !data) {
      toast.error('Erro ao carregar comparação: ' + (error?.message || ''));
      return;
    }
    const rows = data
      .filter((r: any) => r.suppliers)
      .map((r: any) => ({
        supplier_id: r.supplier_id,
        product_name: r.product_name,
        unit_price: Number(r.unit_price),
        price_types: Array.isArray(r.price_types) ? r.price_types : (r.price_types ? JSON.parse(String(r.price_types)) : []),
        supplier_name: (r.suppliers as any)?.name,
      }));
    setCompareRows(rows);
  }, [tenantId]);

  useEffect(() => {
    if (showCompare) loadCompare();
  }, [showCompare, loadCompare]);

  // Agrupa por produto e ordena fornecedores pelo menor preço
  const compareGroups = (() => {
    const map = new Map<string, PriceRowC[]>();
    for (const r of compareRows) {
      const key = r.product_name;
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .filter(([, arr]) => arr.length >= 2)
      .map(([name, arr]) => ({ name, rows: [...arr].sort((a, b) => a.unit_price - b.unit_price) }));
  })();
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const typeLabel = (ts: string[]) =>
    Array.isArray(ts) && ts.includes('cost') && ts.includes('resale') ? 'custo e revenda'
      : Array.isArray(ts) && ts.includes('cost') ? 'custo'
        : 'revenda';

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const pendingCount = suppliers.filter(s => s.lalamove_use_store_api === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setShowCompare(!showCompare)}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${showCompare ? 'bg-primary/20 text-primary' : 'bg-secondary text-foreground hover:bg-secondary/80'}`}
        >
          <BarChart3 className="h-4 w-4" /> Comparar preços entre fornecedores
        </button>
      </div>

      {showCompare && (
        <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> Comparação de preços por produto
          </h3>
          <p className="text-xs text-muted-foreground">Aparelhos que têm preço em mais de um fornecedor — ordenados do mais barato ao mais caro. Quando chegar pedido, dá pra dividir o lote entre os fornecedores com melhor preço.</p>
          {compareLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando preços cadastrados...
            </div>
          )}
          {!compareLoading && compareRows.length === 0 && (
            <p className="text-center text-muted-foreground py-6 text-sm">Nenhum preço cadastrado ainda. Suba o primeiro catálogo TXT (importar catálogo) com um fornecedor informado.</p>
          )}
          {!compareLoading && compareGroups.length === 0 && compareRows.length > 0 && (
            <p className="text-center text-muted-foreground py-6 text-sm">Existem {compareRows.length} preços cadastrados, mas nenhum produto aparece em mais de um fornecedor ainda. Suba um catálogo de outro fornecedor para cruzar os preços.</p>
          )}
          {!compareLoading && compareGroups.map(g => (
            <div key={g.name} className="rounded-md border border-border bg-secondary/30 p-3">
              <p className="text-sm font-medium text-foreground mb-2 break-words">📱 {g.name}</p>
              <div className="space-y-1.5">
                {g.rows.map((r, i) => (
                  <div key={r.supplier_id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${i === 0 ? 'bg-emerald-500/15 border border-emerald-500/40' : 'bg-background/50 border border-border'}`}>
                    <span className="text-foreground min-w-0 break-words">
                      {r.supplier_name}
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{typeLabel(r.price_types)}</span>
                      {i === 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/25 text-emerald-400 font-medium">mais barato</span>}
                    </span>
                    <span className={`font-mono font-medium ${i === 0 ? 'text-emerald-400' : 'text-foreground'}`}>{fmt(r.unit_price)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

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
