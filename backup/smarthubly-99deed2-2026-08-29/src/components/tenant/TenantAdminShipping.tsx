import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProducts, useUpdateProduct } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Truck, MapPin, Package, Save, Loader2 } from 'lucide-react';

interface ShippingConfig {
  shipping_enabled: boolean;
  shipping_base_fee: number;
  shipping_base_radius_km: number;
  shipping_per_km_fee: number;
  shipping_max_fee: number | null;
  shipping_origin_address: string;
  delivery_responsible: 'store' | 'supplier';
  shipping_mode: 'own' | 'lalamove';
  shipping_lalamove_margin_percent: number;
  shipping_lalamove_apply_cap: boolean;
  delivery_max_radius_km: number;
}

const TenantAdminShipping = ({ tenantId }: { tenantId: string }) => {
  const { data: products = [], isLoading: loadingProducts } = useProducts(tenantId);
  const updateProduct = useUpdateProduct();
  const { toast } = useToast();
  const [config, setConfig] = useState<ShippingConfig>({
    shipping_enabled: false,
    shipping_base_fee: 0,
    shipping_base_radius_km: 5,
    shipping_per_km_fee: 0,
    shipping_max_fee: null,
    shipping_origin_address: '',
    delivery_responsible: 'store',
    shipping_mode: 'own',
    shipping_lalamove_margin_percent: 0,
    shipping_lalamove_apply_cap: false,
    delivery_max_radius_km: 0,
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('shipping_enabled, shipping_base_fee, shipping_base_radius_km, shipping_per_km_fee, shipping_max_fee, shipping_origin_address, delivery_responsible, shipping_mode, shipping_lalamove_margin_percent, shipping_lalamove_apply_cap, delivery_max_radius_km')
          .eq('id', tenantId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.error('Erro ao carregar config de frete:', error);
          toast({ title: 'Erro ao carregar configurações', description: error.message, variant: 'destructive' });
        } else if (data) {
          setConfig({
            shipping_enabled: (data as any).shipping_enabled ?? false,
            shipping_base_fee: (data as any).shipping_base_fee ?? 0,
            shipping_base_radius_km: (data as any).shipping_base_radius_km ?? 5,
            shipping_per_km_fee: (data as any).shipping_per_km_fee ?? 0,
            shipping_max_fee: (data as any).shipping_max_fee ?? null,
            shipping_origin_address: (data as any).shipping_origin_address ?? '',
            delivery_responsible: ((data as any).delivery_responsible === 'supplier' ? 'supplier' : 'store'),
            shipping_mode: ((data as any).shipping_mode === 'lalamove' ? 'lalamove' : 'own'),
            shipping_lalamove_margin_percent: Number((data as any).shipping_lalamove_margin_percent ?? 0),
            shipping_lalamove_apply_cap: !!(data as any).shipping_lalamove_apply_cap,
            delivery_max_radius_km: Number((data as any).delivery_max_radius_km ?? 0),
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error('Falha inesperada ao carregar frete:', e);
          toast({ title: 'Erro ao carregar', description: e?.message || 'Falha de rede', variant: 'destructive' });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tenantId, toast]);

  const saveConfig = async () => {
    setSaving(true);
    const { error } = await supabase.from('tenants').update({
      shipping_enabled: config.shipping_enabled,
      shipping_base_fee: config.shipping_base_fee,
      shipping_base_radius_km: config.shipping_base_radius_km,
      shipping_per_km_fee: config.shipping_per_km_fee,
      shipping_max_fee: config.shipping_max_fee,
      shipping_origin_address: config.shipping_origin_address,
      delivery_responsible: config.delivery_responsible,
      shipping_mode: config.shipping_mode,
      shipping_lalamove_margin_percent: config.shipping_lalamove_margin_percent,
      shipping_lalamove_apply_cap: config.shipping_lalamove_apply_cap,
      delivery_max_radius_km: config.delivery_max_radius_km,
    } as any).eq('id', tenantId);
    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    } else {
      toast({ title: '✅ Configurações de frete salvas!' });
    }
  };

  const toggleProductShipping = (productId: string, currentValue: boolean) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    updateProduct.mutate({ ...product, has_shipping: !currentValue } as any);
  };

  if (!loaded) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Global toggle */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground">Frete ativo</p>
              <p className="text-xs text-muted-foreground">Ative para cobrar frete dos clientes</p>
            </div>
          </div>
          <Switch
            checked={config.shipping_enabled}
            onCheckedChange={(v) => setConfig({ ...config, shipping_enabled: v })}
          />
        </div>
      </div>

      {config.shipping_enabled && (
        <>
          {/* Quem faz a entrega + Base de cálculo */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div>
              <p className="font-medium text-foreground text-sm mb-2">Quem faz a entrega?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, delivery_responsible: 'store' })}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${config.delivery_responsible === 'store' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary text-muted-foreground hover:text-foreground'}`}
                >
                  Eu (a loja)
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, delivery_responsible: 'supplier' })}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${config.delivery_responsible === 'supplier' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary text-muted-foreground hover:text-foreground'}`}
                >
                  O fornecedor
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {config.delivery_responsible === 'store'
                  ? 'A loja decide a base de cálculo do frete (configurada abaixo).'
                  : 'O fornecedor responsável pelo pedido decide a base de cálculo no painel dele.'}
              </p>
            </div>

            {config.delivery_responsible === 'store' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="flex-1 pr-3">
                    <p className="font-medium text-foreground text-sm">⚡ Cotar todo pedido via Lalamove</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {config.shipping_mode === 'lalamove'
                        ? 'Ativo — cada pedido é cotado em tempo real pela Lalamove no checkout (sem teto, cliente paga o valor real).'
                        : 'Desativado — usa sua tabela própria abaixo (taxa base + km).'}
                    </p>
                  </div>
                  <Switch
                    checked={config.shipping_mode === 'lalamove'}
                    onCheckedChange={(v) => setConfig({ ...config, shipping_mode: v ? 'lalamove' : 'own' })}
                  />
                </div>

                {config.shipping_mode === 'lalamove' && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                    <div>
                      <label className="text-xs font-medium text-foreground">
                        💰 Margem sobre o frete Lalamove (%)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="Ex: 0 (sem margem) ou 20 (cobra +20% em cima)"
                        value={config.shipping_lalamove_margin_percent}
                        onChange={e => setConfig({ ...config, shipping_lalamove_margin_percent: parseFloat(e.target.value) || 0 })}
                        className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        0% = repassa exato o que o Lalamove cobrar. Acima de 0 = cobra esse extra do cliente como sua margem.
                      </p>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                      <div className="flex-1 pr-3">
                        <p className="text-xs font-medium text-foreground">🛡️ Aplicar teto também ao Lalamove</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {config.shipping_lalamove_apply_cap
                            ? 'Ativo — se o Lalamove cotar acima do teto definido abaixo, o cliente paga só o teto (você banca a diferença).'
                            : 'Desativado — cliente paga o valor real cotado pelo Lalamove, mesmo se passar do teto.'}
                        </p>
                      </div>
                      <Switch
                        checked={config.shipping_lalamove_apply_cap}
                        onCheckedChange={(v) => setConfig({ ...config, shipping_lalamove_apply_cap: v })}
                      />
                    </div>

                    <p className="text-xs text-muted-foreground">
                      ⚠️ Lembrete: precisa de credenciais Lalamove de <strong>produção</strong> configuradas (sandbox é ignorado).
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Origin address */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <h3 className="font-medium text-foreground text-sm">Endereço base (origem)</h3>
            </div>
            <input
              value={config.shipping_origin_address}
              onChange={e => setConfig({ ...config, shipping_origin_address: e.target.value })}
              placeholder="Ex: Rua das Flores 123, Centro, Cidade - UF"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            />
          </div>

          {/* Fee config */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-medium text-foreground text-sm">Valores do frete</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Valor base (R$)</label>
                <input
                  type="number"
                  step="0.50"
                  value={config.shipping_base_fee}
                  onChange={e => setConfig({ ...config, shipping_base_fee: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Cobrado até o raio base</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Raio base (km)</label>
                <input
                  type="number"
                  step="0.5"
                  value={config.shipping_base_radius_km}
                  onChange={e => setConfig({ ...config, shipping_base_radius_km: parseFloat(e.target.value) || 5 })}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Distância coberta pelo valor base</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Por km excedente (R$)</label>
                <input
                  type="number"
                  step="0.50"
                  value={config.shipping_per_km_fee}
                  onChange={e => setConfig({ ...config, shipping_per_km_fee: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Cada km além do raio base</p>
              </div>
            </div>

            {/* Teto opcional do frete — protege o cliente de cobranças absurdas (ex: distância grande) */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 mt-3">
              <label className="text-xs font-medium text-foreground flex items-center gap-1">
                🛡️ Teto máximo do frete (R$) — opcional
              </label>
              <input
                type="number"
                step="1"
                min="0"
                placeholder="Ex: 25 (vazio = sem limite)"
                value={config.shipping_max_fee ?? ''}
                onChange={e => {
                  const v = e.target.value.trim();
                  setConfig({ ...config, shipping_max_fee: v === '' ? null : parseFloat(v) || 0 });
                }}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Se preenchido, o cliente nunca paga mais que esse valor de frete. Útil pra evitar frete de R$50 em entregas longas.
              </p>
            </div>
          </div>

          {/* Raio máximo de entrega — bloqueia checkout fora do raio */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <label className="text-xs font-medium text-foreground flex items-center gap-1">
              📍 Raio máximo de entrega (km)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              placeholder="0 = sem limite"
              value={config.delivery_max_radius_km || ''}
              onChange={e => {
                const v = e.target.value.trim();
                setConfig({ ...config, delivery_max_radius_km: v === '' ? 0 : parseFloat(v) || 0 });
              }}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Clientes além desta distância não conseguirão finalizar entrega (verão mensagem para retirar na loja). <strong>0 ou vazio = entrega para qualquer distância.</strong>
            </p>
          </div>

          {/* Save button */}
          <button onClick={saveConfig} disabled={saving} className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar Configurações
          </button>

          {/* Per-product shipping toggles */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="font-medium text-foreground text-sm">Frete por produto</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Ative o frete nos produtos que precisam de entrega. Defina um valor fixo (opcional) e/ou um endereço de origem diferente (ex: endereço do fornecedor).
            </p>
            {products.length === 0 && <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>}
            {products.map(p => (
              <div key={p.id} className="py-3 border-b border-border last:border-0 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                      {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-primary/40" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">R${p.price.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(p as any).has_shipping && (
                      <input
                        type="number"
                        step="0.50"
                        value={(p as any).shipping_fee_override ?? ''}
                        onChange={e => {
                          const val = e.target.value ? parseFloat(e.target.value) : null;
                          updateProduct.mutate({ ...p, shipping_fee_override: val } as any);
                        }}
                        placeholder="Auto"
                        title="Frete fixo personalizado (deixe vazio para usar o cálculo global)"
                        className="w-20 rounded-lg border border-border bg-secondary px-2 py-1 text-xs text-foreground text-center"
                      />
                    )}
                    <Switch
                      checked={(p as any).has_shipping ?? false}
                      onCheckedChange={() => toggleProductShipping(p.id, (p as any).has_shipping ?? false)}
                    />
                  </div>
                </div>
                {(p as any).has_shipping && (
                  <div className="ml-11">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> Endereço de origem (deixe vazio para usar o padrão da loja)
                    </label>
                    <input
                      value={(p as any).shipping_origin_override ?? ''}
                      onChange={e => {
                        const val = e.target.value || null;
                        updateProduct.mutate({ ...p, shipping_origin_override: val } as any);
                      }}
                      placeholder={config.shipping_origin_address || 'Endereço base da loja'}
                      className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs text-foreground"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!config.shipping_enabled && (
        <div className="text-center py-8 text-muted-foreground">
          <Truck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">O frete está desativado. Ative para configurar valores e produtos.</p>
        </div>
      )}
    </div>
  );
};

export default TenantAdminShipping;
