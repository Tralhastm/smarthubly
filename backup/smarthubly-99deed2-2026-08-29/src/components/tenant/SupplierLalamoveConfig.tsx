import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Truck, Save, Send, Eye, EyeOff, Trash2, AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { toast } from 'sonner';

type Supplier = {
  id: string;
  tenant_id: string;
  lalamove_api_key: string;
  lalamove_api_secret: string;
  lalamove_market: string;
  lalamove_sandbox: boolean;
  lalamove_use_store_api: string;
};

type Tenant = {
  name: string;
  lalamove_enabled: boolean;
  lalamove_market: string | null;
};

const STATUS_BADGES: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  none: { label: 'Não solicitado', cls: 'bg-secondary text-muted-foreground', icon: <AlertCircle className="h-3 w-3" /> },
  pending: { label: 'Pendente — aguardando loja', cls: 'bg-yellow-500/20 text-yellow-400', icon: <Clock className="h-3 w-3" /> },
  approved: { label: 'Aprovado pela loja', cls: 'bg-green-500/20 text-green-400', icon: <CheckCircle className="h-3 w-3" /> },
  revoked: { label: 'Revogado pela loja', cls: 'bg-red-500/20 text-red-400', icon: <XCircle className="h-3 w-3" /> },
};

const SupplierLalamoveConfig = ({ supplierId }: { supplierId: string }) => {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [editingOwn, setEditingOwn] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [market, setMarket] = useState('BR_SAO');
  const [sandbox, setSandbox] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data: sup } = await supabase
      .from('suppliers')
      .select('id, tenant_id, lalamove_api_key, lalamove_api_secret, lalamove_market, lalamove_sandbox, lalamove_use_store_api')
      .eq('id', supplierId).single();
    if (sup) {
      const s = sup as any as Supplier;
      setSupplier(s);
      setApiKey(s.lalamove_api_key || '');
      setApiSecret(s.lalamove_api_secret || '');
      setMarket(s.lalamove_market || 'BR_SAO');
      setSandbox(!!s.lalamove_sandbox);
      const { data: t } = await supabase.from('tenants')
        .select('name, lalamove_enabled, lalamove_market').eq('id', s.tenant_id).single();
      setTenant(t as any);
    }
  };

  useEffect(() => { load(); }, [supplierId]);

  const saveOwnApi = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error('Informe a API Key e a API Secret.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('suppliers').update({
      lalamove_api_key: apiKey.trim(),
      lalamove_api_secret: apiSecret.trim(),
      lalamove_market: market,
      lalamove_sandbox: sandbox,
    } as any).eq('id', supplierId);
    setSaving(false);
    if (error) { toast.error('Erro ao salvar: ' + error.message); return; }
    toast.success('API própria salva!');
    setEditingOwn(false);
    load();
  };

  const removeOwnApi = async () => {
    if (!confirm('Remover sua API Lalamove? Você passará a precisar da API da loja.')) return;
    const { error } = await supabase.from('suppliers').update({
      lalamove_api_key: '', lalamove_api_secret: '',
    } as any).eq('id', supplierId);
    if (error) { toast.error(error.message); return; }
    toast.success('API própria removida.');
    setApiKey(''); setApiSecret('');
    load();
  };

  const requestStoreApi = async () => {
    const { error } = await supabase.from('suppliers').update({
      lalamove_use_store_api: 'pending',
    } as any).eq('id', supplierId);
    if (error) { toast.error(error.message); return; }
    toast.success('Solicitação enviada à loja!');
    load();
  };

  if (!supplier) return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  const hasOwnApi = !!supplier.lalamove_api_key && !!supplier.lalamove_api_secret;
  const storeStatus = supplier.lalamove_use_store_api || 'none';
  const storeBadge = STATUS_BADGES[storeStatus] || STATUS_BADGES.none;

  // Origem efetiva e quem paga (regra: própria = fornecedor; loja = loja)
  const activeOrigin = hasOwnApi ? 'own' : (storeStatus === 'approved' ? 'store' : null);

  return (
    <div className="space-y-4">
      {/* Status atual */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="font-heading text-foreground flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" /> API Lalamove em uso
        </h3>
        {activeOrigin === 'own' && (
          <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3 text-xs text-green-400">
            ✅ <strong>API própria ativa.</strong> Você paga as corridas que acionar.
            {sandbox && <span className="ml-2 px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">SANDBOX</span>}
          </div>
        )}
        {activeOrigin === 'store' && (
          <div className="rounded-md bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-blue-400">
            ✅ <strong>API da loja ({tenant?.name}) aprovada.</strong> A loja paga as corridas.
          </div>
        )}
        {!activeOrigin && (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-400">
            ⚠️ Nenhuma API Lalamove disponível. Cadastre a sua ou solicite acesso à da loja abaixo.
          </div>
        )}
      </div>

      {/* OPÇÃO 1: API própria */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-foreground flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" /> Sua API Lalamove
          </h3>
          {hasOwnApi && !editingOwn && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Configurada</span>
          )}
        </div>

        {hasOwnApi && !editingOwn ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              API Key: <code className="text-foreground">{supplier.lalamove_api_key.slice(0, 8)}••••••</code>
            </p>
            <p className="text-xs text-muted-foreground">Mercado: {supplier.lalamove_market} · Modo: {supplier.lalamove_sandbox ? 'Sandbox' : 'Produção'}</p>
            <div className="flex gap-2">
              <button onClick={() => setEditingOwn(true)}
                className="rounded-md bg-secondary text-foreground px-3 py-1.5 text-xs hover:bg-primary/20">
                Editar
              </button>
              <button onClick={removeOwnApi}
                className="rounded-md bg-red-500/20 text-red-400 px-3 py-1.5 text-xs hover:bg-red-500/30 flex items-center gap-1">
                <Trash2 className="h-3 w-3" /> Remover
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {!hasOwnApi && (
              <p className="text-xs text-muted-foreground">
                Cadastre suas credenciais Lalamove (você paga as corridas).
                Pegue em <a href="https://partner.lalamove.com" target="_blank" rel="noreferrer" className="text-primary underline">partner.lalamove.com</a>.
              </p>
            )}
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="API Key"
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none" />
              <button type="button" onClick={() => setShowKey(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="relative">
              <input type={showSecret ? 'text' : 'password'} value={apiSecret} onChange={e => setApiSecret(e.target.value)}
                placeholder="API Secret"
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none" />
              <button type="button" onClick={() => setShowSecret(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <select value={market} onChange={e => setMarket(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none">
                <option value="BR_SAO">BR — São Paulo</option>
                <option value="BR_RIO">BR — Rio de Janeiro</option>
                <option value="BR_BHZ">BR — Belo Horizonte</option>
                <option value="BR_CPQ">BR — Campinas</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} />
                Sandbox
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={saveOwnApi} disabled={saving}
                className="rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-xs flex items-center gap-1 hover:opacity-90 disabled:opacity-50">
                <Save className="h-3 w-3" /> {saving ? 'Salvando...' : 'Salvar API própria'}
              </button>
              {editingOwn && (
                <button onClick={() => { setEditingOwn(false); load(); }}
                  className="rounded-lg bg-secondary text-foreground px-3 py-1.5 text-xs">
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* OPÇÃO 2: Usar API da loja */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-foreground flex items-center gap-2">
            <Truck className="h-4 w-4 text-orange-400" /> Usar API da loja {tenant && <span className="text-xs text-muted-foreground">({tenant.name})</span>}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${storeBadge.cls}`}>
            {storeBadge.icon} {storeBadge.label}
          </span>
        </div>

        {!tenant?.lalamove_enabled && (
          <p className="text-xs text-yellow-400">⚠️ A loja ainda não habilitou Lalamove. Não é possível solicitar acesso agora.</p>
        )}

        {tenant?.lalamove_enabled && storeStatus === 'none' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Solicita à loja acesso à API Lalamove dela. Quando aprovada, a loja paga as corridas.
            </p>
            <button onClick={requestStoreApi}
              className="rounded-lg bg-orange-500/20 text-orange-400 px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-orange-500/30">
              <Send className="h-3 w-3" /> Solicitar uso da API da loja
            </button>
          </div>
        )}

        {storeStatus === 'pending' && (
          <p className="text-xs text-yellow-400">⏳ Sua solicitação está pendente. Aguarde a loja aprovar.</p>
        )}

        {storeStatus === 'approved' && (
          <p className="text-xs text-green-400">✅ Você está autorizado a usar a API da loja. Loja paga as corridas.</p>
        )}

        {storeStatus === 'revoked' && (
          <div className="space-y-2">
            <p className="text-xs text-red-400">❌ A loja revogou seu acesso. Você pode solicitar novamente.</p>
            <button onClick={requestStoreApi}
              className="rounded-lg bg-orange-500/20 text-orange-400 px-3 py-1.5 text-xs hover:bg-orange-500/30">
              Solicitar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierLalamoveConfig;
