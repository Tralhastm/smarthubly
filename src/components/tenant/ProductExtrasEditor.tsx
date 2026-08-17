import { useState } from 'react';
import { useProductVariants, useProductAddons, useSaveVariant, useDeleteVariant, useSaveAddon, useDeleteAddon } from '@/hooks/useProductExtras';
import { Plus, Trash2, X, Check, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  productId: string;
  tenantId: string;
}

// Editor inline de variantes e adicionais. Use embaixo do produto no admin.
const ProductExtrasEditor = ({ productId, tenantId }: Props) => {
  const [open, setOpen] = useState(false);
  const { data: variants = [] } = useProductVariants(open ? productId : undefined);
  const { data: addons = [] } = useProductAddons(open ? productId : undefined);
  const saveVariant = useSaveVariant();
  const deleteVariant = useDeleteVariant(productId);
  const saveAddon = useSaveAddon();
  const deleteAddon = useDeleteAddon(productId);

  const [vName, setVName] = useState('');
  const [vDelta, setVDelta] = useState('');
  const [aName, setAName] = useState('');
  const [aPrice, setAPrice] = useState('');
  const [aRequired, setARequired] = useState(false);
  const [aMax, setAMax] = useState('1');

  const addVariant = async () => {
    if (!vName.trim()) return;
    await saveVariant.mutateAsync({
      product_id: productId,
      tenant_id: tenantId,
      name: vName.trim(),
      price_delta: parseFloat(vDelta) || 0,
      sort_order: variants.length,
    });
    setVName(''); setVDelta('');
    toast.success('Variante adicionada');
  };

  const addAddon = async () => {
    if (!aName.trim()) return;
    await saveAddon.mutateAsync({
      product_id: productId,
      tenant_id: tenantId,
      name: aName.trim(),
      price: parseFloat(aPrice) || 0,
      required: aRequired,
      max_quantity: parseInt(aMax) || 1,
      sort_order: addons.length,
    });
    setAName(''); setAPrice(''); setARequired(false); setAMax('1');
    toast.success('Adicional adicionado');
  };

  return (
    <div className="border-t border-border pt-2 mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-xs text-muted-foreground hover:text-foreground py-1"
      >
        <span className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          Variantes ({variants.length}) & Adicionais ({addons.length})
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-secondary/40 border border-border p-3">
          {/* VARIANTES */}
          <div>
            <p className="text-[11px] font-medium text-foreground mb-1.5">Variantes (escolha única — ex: P, M, G)</p>
            <div className="space-y-1.5 mb-2">
              {variants.map(v => (
                <div key={v.id} className="flex items-center gap-1.5 text-xs">
                  <span className="flex-1 text-foreground truncate">{v.name}</span>
                  <span className="text-primary text-[11px]">{v.price_delta > 0 ? '+' : ''}R${v.price_delta.toFixed(2)}</span>
                  <button
                    onClick={() => deleteVariant.mutate(v.id)}
                    className="text-muted-foreground hover:text-destructive p-0.5"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={vName}
                onChange={e => setVName(e.target.value)}
                placeholder="Nome (ex: Médio)"
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
              />
              <input
                value={vDelta}
                onChange={e => setVDelta(e.target.value)}
                placeholder="+R$"
                type="number"
                step="0.01"
                className="w-16 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
              />
              <button
                onClick={addVariant}
                className="rounded-md gradient-primary text-primary-foreground px-2 py-1 text-xs flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* ADICIONAIS */}
          <div className="border-t border-border pt-2">
            <p className="text-[11px] font-medium text-foreground mb-1.5">Adicionais (múltiplos — ex: bacon, queijo)</p>
            <div className="space-y-1.5 mb-2">
              {addons.map(a => (
                <div key={a.id} className="flex items-center gap-1.5 text-xs">
                  <span className="flex-1 text-foreground truncate">
                    {a.name}{a.required && <span className="text-destructive">*</span>}
                    {a.max_quantity > 1 && <span className="text-muted-foreground"> · max {a.max_quantity}</span>}
                  </span>
                  <span className="text-primary text-[11px]">+R${a.price.toFixed(2)}</span>
                  <button
                    onClick={() => deleteAddon.mutate(a.id)}
                    className="text-muted-foreground hover:text-destructive p-0.5"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  value={aName}
                  onChange={e => setAName(e.target.value)}
                  placeholder="Nome (ex: Bacon)"
                  className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                />
                <input
                  value={aPrice}
                  onChange={e => setAPrice(e.target.value)}
                  placeholder="R$"
                  type="number"
                  step="0.01"
                  className="w-16 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 text-[11px] text-foreground cursor-pointer">
                  <input type="checkbox" checked={aRequired} onChange={e => setARequired(e.target.checked)} className="accent-primary h-3 w-3" />
                  Obrigatório
                </label>
                <input
                  value={aMax}
                  onChange={e => setAMax(e.target.value)}
                  type="number"
                  min={1}
                  placeholder="max"
                  title="Quantidade máxima"
                  className="w-12 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                />
                <button
                  onClick={addAddon}
                  className="ml-auto rounded-md gradient-primary text-primary-foreground px-3 py-1 text-xs flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Adicionar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductExtrasEditor;
