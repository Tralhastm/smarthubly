import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Copy, User, Store, Truck } from 'lucide-react';
import { toast } from 'sonner';

type Driver = {
  id: string;
  name: string;
  phone: string;
  access_token: string;
  is_online: boolean;
  last_online_at: string | null;
  supplier_id: string | null;
  active: boolean;
};

const ONLINE_THRESHOLD_MS = 10 * 60_000; // 10 min de tolerância (heartbeat é a cada 60s)

const SupplierDriversPanel = ({ supplierId, tenantId, supplierName }: { supplierId: string; tenantId: string; supplierName: string }) => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string>('');

  useEffect(() => {
    supabase.from('tenants').select('slug').eq('id', tenantId).maybeSingle()
      .then(({ data }) => { if (data?.slug) setTenantSlug(data.slug); });
  }, [tenantId]);

  const fetchDrivers = useCallback(async () => {
    const { data, error } = await supabase
      .from('drivers')
      .select('id, name, phone, access_token, is_online, last_online_at, supplier_id, active')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('created_at');
    if (error) {
      console.error(error);
      toast.error('Erro ao carregar motoboys');
    } else {
      setDrivers((data as Driver[]) || []);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    fetchDrivers();
    const i = setInterval(fetchDrivers, 10_000); // refresh status online a cada 10s
    return () => clearInterval(i);
  }, [fetchDrivers]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    const { error } = await supabase.from('drivers').insert({
      tenant_id: tenantId,
      supplier_id: supplierId,
      name: name.trim(),
      phone: phone.trim(),
    } as any);
    setAdding(false);
    if (error) {
      toast.error(`Erro: ${error.message}`);
      return;
    }
    setName(''); setPhone('');
    toast.success('Motoboy cadastrado!');
    fetchDrivers();
  };

  const handleDelete = async (d: Driver) => {
    if (d.supplier_id !== supplierId) {
      toast.error('Você só pode remover seus próprios motoboys.');
      return;
    }
    if (!confirm(`Remover motoboy "${d.name}"?`)) return;
    const { error } = await supabase.from('drivers').delete().eq('id', d.id);
    if (error) {
      toast.error(`Erro: ${error.message}`);
      return;
    }
    toast.success('Motoboy removido');
    fetchDrivers();
  };

  const copyLink = (token: string) => {
    if (!tenantSlug) {
      toast.error('Aguarde o carregamento da loja...');
      return;
    }
    const url = `${window.location.origin}/loja/${tenantSlug}/motoboy/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiado!');
  };

  const isOnline = (d: Driver) => {
    if (!d.is_online) return false;
    // Se está marcado online mas sem timestamp, considera online (recém ligou)
    if (!d.last_online_at) return true;
    return Date.now() - new Date(d.last_online_at).getTime() < ONLINE_THRESHOLD_MS;
  };

  const myDrivers = drivers.filter(d => d.supplier_id === supplierId);
  const storeDrivers = drivers.filter(d => !d.supplier_id);
  const otherSupplierDrivers = drivers.filter(d => d.supplier_id && d.supplier_id !== supplierId);

  const onlineCount = drivers.filter(isOnline).length;

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" /> Motoboys disponíveis
          </h2>
          <span className="text-sm text-muted-foreground">
            <span className="text-green-400 font-bold">{onlineCount}</span> online de {drivers.length}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Você pode cadastrar seus próprios motoboys e também ver os da loja.</p>
      </div>

      {/* Cadastro */}
      <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-heading text-foreground text-sm">Cadastrar novo motoboy meu</h3>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Nome"
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Telefone (opcional)"
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={adding || !name.trim()}
          className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {adding ? 'Cadastrando...' : 'Cadastrar'}
        </button>
      </form>

      {/* Meus motoboys */}
      <DriverSection
        title={`Meus motoboys (${supplierName})`}
        icon={<User className="h-4 w-4 text-primary" />}
        drivers={myDrivers}
        isOnline={isOnline}
        canDelete
        onDelete={handleDelete}
        onCopy={copyLink}
        emptyText="Você ainda não cadastrou nenhum motoboy próprio."
      />

      {/* Motoboys da loja */}
      <DriverSection
        title="Motoboys da loja"
        icon={<Store className="h-4 w-4 text-blue-400" />}
        drivers={storeDrivers}
        isOnline={isOnline}
        emptyText="A loja ainda não cadastrou motoboys."
      />

      {/* Motoboys de outros fornecedores (só visualização) */}
      {otherSupplierDrivers.length > 0 && (
        <DriverSection
          title="Motoboys de outros fornecedores"
          icon={<User className="h-4 w-4 text-muted-foreground" />}
          drivers={otherSupplierDrivers}
          isOnline={isOnline}
          hideContact
        />
      )}
    </div>
  );
};

const DriverSection = ({
  title, icon, drivers, isOnline, canDelete, onDelete, onCopy, emptyText, hideContact,
}: {
  title: string;
  icon: React.ReactNode;
  drivers: Driver[];
  isOnline: (d: Driver) => boolean;
  canDelete?: boolean;
  onDelete?: (d: Driver) => void;
  onCopy?: (token: string) => void;
  emptyText?: string;
  hideContact?: boolean;
}) => (
  <div>
    <h3 className="font-heading text-foreground mb-2 text-sm flex items-center gap-2">
      {icon} {title}
      <span className="text-xs font-normal text-muted-foreground">({drivers.length})</span>
    </h3>
    {drivers.length === 0 && emptyText && (
      <p className="text-center text-muted-foreground py-4 text-sm">{emptyText}</p>
    )}
    <div className="space-y-2">
      {drivers.map(d => {
        const online = isOnline(d);
        return (
          <div key={d.id} className="rounded-lg border border-border bg-card p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`inline-block h-2 w-2 rounded-full shrink-0 ${online ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'}`}
                title={online ? 'Online' : 'Offline'}
              />
              <div className="min-w-0">
                <p className="font-medium text-foreground text-sm truncate">{d.name}</p>
                <p className={`text-[10px] ${online ? 'text-green-500' : 'text-muted-foreground'}`}>
                  {online ? '🟢 Disponível agora' : d.last_online_at ? `⚫ Offline · visto ${new Date(d.last_online_at).toLocaleString('pt-BR')}` : '⚫ Nunca conectou'}
                </p>
                {!hideContact && d.phone && (
                  <p className="text-xs text-muted-foreground truncate">📞 {d.phone}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canDelete && onCopy && (
                <button onClick={() => onCopy(d.access_token)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Copy className="h-3 w-3" /> Link
                </button>
              )}
              {canDelete && onDelete && (
                <button onClick={() => onDelete(d)} className="text-destructive hover:text-destructive/80">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

export default SupplierDriversPanel;
