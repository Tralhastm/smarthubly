import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, Save, Loader2, Info, Truck } from 'lucide-react';
import CepAddressForm from '@/components/shared/CepAddressForm';

type Props = {
  supplierId: string;
  initialAddress: string;
  onAddressUpdated?: (newAddress: string) => void;
};

const SupplierShippingConfig = ({ supplierId, initialAddress, onAddressUpdated }: Props) => {
  const [address, setAddress] = useState(initialAddress || '');
  const [baseFee, setBaseFee] = useState(0);
  const [baseRadius, setBaseRadius] = useState(5);
  const [perKmFee, setPerKmFee] = useState(0);
  const [maxFee, setMaxFee] = useState<string>(''); // string pra suportar vazio = sem teto
  const [maxRadius, setMaxRadius] = useState<string>(''); // string pra suportar vazio = sem limite
  const [shippingMode, setShippingMode] = useState<'own' | 'lalamove'>('own');
  const [tenantDelegates, setTenantDelegates] = useState<boolean>(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('suppliers')
          .select('address, shipping_base_fee, shipping_base_radius_km, shipping_per_km_fee, shipping_max_fee, shipping_mode, tenant_id, delivery_max_radius_km')
          .eq('id', supplierId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          toast.error('Erro ao carregar configurações de frete');
          console.error(error);
        } else if (data) {
          setAddress((data as any).address ?? '');
          setBaseFee(Number((data as any).shipping_base_fee ?? 0));
          setBaseRadius(Number((data as any).shipping_base_radius_km ?? 5));
          setPerKmFee(Number((data as any).shipping_per_km_fee ?? 0));
          const mf = (data as any).shipping_max_fee;
          setMaxFee(mf == null ? '' : String(mf));
          const mr = Number((data as any).delivery_max_radius_km ?? 0);
          setMaxRadius(mr > 0 ? String(mr) : '');
          setShippingMode(((data as any).shipping_mode === 'lalamove' ? 'lalamove' : 'own'));

          // Verifica se a loja delega ao fornecedor
          const tenantId = (data as any).tenant_id;
          if (tenantId) {
            const { data: tenantData } = await supabase
              .from('tenants')
              .select('delivery_responsible')
              .eq('id', tenantId)
              .maybeSingle();
            if (!cancelled) {
              setTenantDelegates(((tenantData as any)?.delivery_responsible || 'store') === 'supplier');
            }
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [supplierId]);

  const save = async () => {
    if (!address.trim()) {
      toast.error('Informe seu endereço base');
      return;
    }
    setSaving(true);
    const parsedMax = maxFee.trim() === '' ? null : Number(maxFee);
    const parsedMaxRadius = maxRadius.trim() === '' ? 0 : (Number(maxRadius) || 0);
    const { error } = await supabase.from('suppliers').update({
      address: address.trim(),
      shipping_base_fee: baseFee,
      shipping_base_radius_km: baseRadius,
      shipping_per_km_fee: perKmFee,
      shipping_max_fee: parsedMax,
      shipping_mode: shippingMode,
      delivery_max_radius_km: parsedMaxRadius,
    } as any).eq('id', supplierId);
    setSaving(false);
    if (error) {
      toast.error('Erro ao salvar: ' + error.message);
    } else {
      toast.success('✅ Frete salvo!');
      onAddressUpdated?.(address.trim());
    }
  };

  if (!loaded) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start gap-2">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Configure aqui o <strong className="text-foreground">endereço base</strong> de onde seus produtos saem e quanto cobra de frete.
          O cálculo é feito automaticamente a partir desse endereço quando o cliente informa o destino.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-foreground text-sm">Endereço base (origem do despacho)</h3>
        </div>
        <CepAddressForm
          initialAddress={address}
          onChange={(composed) => setAddress(composed)}
          showReference={false}
          showComplement={true}
        />
      </div>

      {/* Base de cálculo do frete */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <p className="font-medium text-foreground text-sm">Base de cálculo do frete</p>
        {!tenantDelegates && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              ⚠️ A loja está com "Eu (a loja)" marcado em <strong className="text-foreground">Quem faz a entrega?</strong> — sua escolha aqui só será usada se a loja te delegar.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setShippingMode('own')}
            className={`rounded-lg border px-3 py-2 text-sm transition ${shippingMode === 'own' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            Minha tabela
          </button>
          <button
            type="button"
            onClick={() => setShippingMode('lalamove')}
            className={`rounded-lg border px-3 py-2 text-sm transition ${shippingMode === 'lalamove' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            Cotar via Lalamove
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {shippingMode === 'own'
            ? 'Cobra do cliente pela sua tabela abaixo (taxa base + km excedente).'
            : 'Cobra o valor cotado em tempo real pela Lalamove (configure suas credenciais de produção na aba Lalamove).'}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Valor base (R$)</label>
            <input
              type="number" step="0.50" min="0"
              value={baseFee}
              onChange={e => setBaseFee(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">Cobrado até o raio base</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Raio base (km)</label>
            <input
              type="number" step="0.5" min="0"
              value={baseRadius}
              onChange={e => setBaseRadius(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">Distância coberta pelo valor base</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Por km excedente (R$)</label>
            <input
              type="number" step="0.50" min="0"
              value={perKmFee}
              onChange={e => setPerKmFee(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">Cada km além do raio base</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Exemplo: base R$5 em 3 km + R$1,50/km. Pra 7 km cobra R$5 + (7-3)×R$1,50 = <strong className="text-foreground">R$11,00</strong>
        </p>
      </div>

      {/* Teto opcional do frete */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <p className="font-medium text-foreground text-sm">Teto do frete (opcional)</p>
        <p className="text-xs text-muted-foreground">
          Se o cálculo passar deste valor, o cliente paga só o teto. Deixe vazio = sem teto.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">R$</span>
          <input
            type="number" step="0.50" min="0"
            value={maxFee}
            onChange={e => setMaxFee(e.target.value)}
            placeholder="Ex: 25,00"
            className="w-32 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
          />
          {maxFee && (
            <button type="button" onClick={() => setMaxFee('')} className="text-xs text-muted-foreground hover:text-foreground underline">
              Limpar
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          💡 Se a loja também tiver teto, o seu prevalece quando definido aqui.
        </p>
      </div>

      {/* Raio máximo de entrega — bloqueia pedidos fora do raio */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <p className="font-medium text-foreground text-sm">📍 Raio máximo de entrega (km)</p>
        <p className="text-xs text-muted-foreground">
          Clientes além desta distância não conseguirão pedir os seus produtos. Deixe vazio = entrega para qualquer distância.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number" step="0.5" min="0"
            value={maxRadius}
            onChange={e => setMaxRadius(e.target.value)}
            placeholder="Ex: 15"
            className="w-32 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
          />
          <span className="text-sm text-muted-foreground">km</span>
          {maxRadius && (
            <button type="button" onClick={() => setMaxRadius('')} className="text-xs text-muted-foreground hover:text-foreground underline">
              Limpar
            </button>
          )}
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Salvar
      </button>
    </div>
  );
};

export default SupplierShippingConfig;
