import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ShoppingCart, Send, Zap, Plus, Trash2, RefreshCw, Package } from 'lucide-react';
import { toast } from 'sonner';
import { productMatchKey } from '@/lib/product-match';

type Supplier = { id: string; name: string; phone: string | null; active: boolean };

type PriceRow = { supplier_id: string; product_name: string; unit_price: number; available: boolean };

type CartItem = { name: string; quantity: number };

type Fragment = { supplier: Supplier; items: { name: string; quantity: number; unit_price: number }[]; total: number };

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Seletor de melhor preço por fornecedor com fragmentação de lote.
 *
 * O lojista monta um pedido de compra (entrada/reposição). Ao clicar em
 * "Distribuir pelo melhor preço", cada item é atribuído ao fornecedor que
 * tabelou o menor preço (fornecedor ativo + produto disponível). O lote é
 * fragmentado por fornecedor e o lojista envia uma mensagem WhatsApp pronta
 * para cada fornecedor do fragmento.
 */
const SupplierPurchaseSelector = ({ tenantId }: { tenantId: string }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [items, setItems] = useState<CartItem[]>([]);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('1');

  const load = useCallback(async () => {
    const { data: s } = await supabase
      .from('suppliers')
      .select('id, name, phone, active')
      .eq('tenant_id', tenantId);
    setSuppliers(((s as Supplier[]) || []).filter(x => Boolean(x.active)));
    const { data: p } = await supabase
      .from('supplier_product_prices')
      .select('supplier_id, product_name, unit_price, available')
      .eq('available', true);
    setPrices(((p as PriceRow[]) || []).map(r => ({ ...r, unit_price: Number(r.unit_price) })));
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const cheapestByProduct = useMemo(() => {
    const map = new Map<string, { supplier_id: string; unit_price: number }>();
    for (const p of prices) {
      const key = productMatchKey(p.product_name);
      const cur = map.get(key);
      if (!cur || p.unit_price < cur.unit_price) map.set(key, { supplier_id: p.supplier_id, unit_price: p.unit_price });
    }
    return map;
  }, [prices]);

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);

  const addItem = () => {
    const name = itemName.trim();
    const qty = parseInt(itemQty, 10);
    if (!name) {
      toast.error('Informe o nome do produto');
      return;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      toast.error('Informe uma quantidade válida');
      return;
    }
    setItems(prev => {
      const existing = prev.find(i => i.name.toLowerCase() === name.toLowerCase());
      if (existing) return prev.map(i => (i === existing ? { ...i, quantity: i.quantity + qty } : i));
      return [...prev, { name, quantity: qty }];
    });
    setItemName('');
    setItemQty('1');
  };

  const removeItem = (name: string) => setItems(prev => prev.filter(i => i.name !== name));

  const distribute = () => {
    if (items.length === 0) {
      toast.error('Adicione pelo menos 1 item ao pedido');
      return;
    }
    const frags = new Map<string, Fragment>();
    const unassigned: string[] = [];

    for (const item of items) {
      if (mode === 'auto') {
        const best = cheapestByProduct.get(productMatchKey(item.name));
        if (!best) {
          unassigned.push(item.name);
          continue;
        }
        const supplier = supplierById.get(best.supplier_id);
        if (!supplier) {
          unassigned.push(item.name);
          continue;
        }
        const frag = frags.get(best.supplier_id) || { supplier, items: [], total: 0 };
        const lineTotal = best.unit_price * item.quantity;
        frag.items.push({ name: item.name, quantity: item.quantity, unit_price: best.unit_price });
        frag.total += lineTotal;
        frags.set(best.supplier_id, frag);
      } else {
        // Modo manual: um único fornecedor escolhido na hora
        const name = prompt('Nome do fornecedor deste lote:', '');
        if (!name) return;
        const supplier = suppliers.find(s => s.name.toLowerCase().includes(name.toLowerCase()));
        if (!supplier) {
          toast.error('Fornecedor não encontrado');
          return;
        }
        const frag = frags.get(supplier.id) || { supplier, items: [], total: 0 };
        const price = prompt(`Preço unitário de "${item.name}" (R$):`, '');
        const unit = parseFloat((price || '').replace(',', '.'));
        if (Number.isNaN(unit) || unit <= 0) {
          toast.error('Preço inválido');
          return;
        }
        frag.items.push({ name: item.name, quantity: item.quantity, unit_price: unit });
        frag.total += unit * item.quantity;
        frags.set(supplier.id, frag);
      }
    }

    setFragments(Array.from(frags.values()).sort((a, b) => b.total - a.total));
    if (unassigned.length > 0) {
      toast.warning(`${unassigned.length} item(s) sem preço de fornecedor: ${unassigned.slice(0, 3).join(', ')}`, { duration: 6000 });
    } else if (frags.size === 0 && mode === 'auto') {
      toast.error('Nenhum item encontrou fornecedor. Cadastre os preços na aba "Meus preços" de cada fornecedor.');
    } else {
      toast.success(`Lote fragmentado em ${frags.size} fornecedor(es) pelo melhor preço`);
    }
  };

  const saveFragments = async () => {
    // Salva registros de pedido por fornecedor para registro/histórico (status 'received', cliente = a própria loja)
    for (const frag of fragments) {
      const { data: orderId, error } = await (supabase as any).rpc('place_order', {
        _order: {
          tenant_id: tenantId,
          supplier_id: frag.supplier.id,
          customer_name: 'Compra — loja (entrada)',
          customer_phone: '00000000000',
          status: 'received',
          delivery_type: 'pickup',
          payment_method: 'A combinar',
          total: frag.total,
        },
        _items: frag.items.map(i => ({
          product_name: i.name,
          product_price: i.unit_price,
          quantity: i.quantity,
        })),
      });
      if (error) {
        toast.error(`Erro ao registrar pedido p/ ${frag.supplier.name}: ${error.message}`);
        return false;
      }
      toast.success(`Pedido registrado: ${frag.supplier.name} — R$ ${fmtBRL(frag.total)}`);
      void orderId;
    }
    return true;
  };

  const sendWhatsApp = (frag: Fragment) => {
    if (!frag.supplier.phone) {
      toast.error(`Fornecedor "${frag.supplier.name}" sem telefone cadastrado`);
      return;
    }
    const lines = [
      `*Pedido de compra — SmartHubly*`,
      '',
      `Loja: SmartHubly (lojista)`,
      `Data: ${new Date().toLocaleDateString('pt-BR')}`,
      '',
      ...frag.items.map(i => `• ${i.quantity}x ${i.name} — R$ ${fmtBRL(i.unit_price)} un. = R$ ${fmtBRL(i.unit_price * i.quantity)}`),
      '',
      `*Total: R$ ${fmtBRL(frag.total)}*`,
      '',
      'Podemos confirmar? Obrigado!',
    ];
    const msg = encodeURIComponent(lines.join('\n'));
    const phone = frag.supplier.phone.replace(/\D/g, '');
    const ddi = phone.startsWith('55') ? phone : `55${phone}`;
    window.open(`https://wa.me/${ddi}?text=${msg}`, '_blank');
  };

  const totalAll = useMemo(() => fragments.reduce((s, f) => s + f.total, 0), [fragments]);

  const reset = () => {
    setItems([]);
    setFragments([]);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <p className="text-sm font-medium text-foreground flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-primary" /> Pedido de compra aos fornecedores
        </p>
        <p className="text-xs text-muted-foreground">
          Monte o pedido de entrada/reposição. No modo <strong>automático</strong>, cada item vai
          para o fornecedor com o menor preço tabelado (fragmenta o lote por fornecedor). No modo
          <strong> manual</strong>, você escolhe o fornecedor e o preço de cada lote.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={itemName}
            onChange={e => setItemName(e.target.value)}
            placeholder="Ex: iphone 16 128gb"
            className="flex-1 min-w-[160px] rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
          <input
            value={itemQty}
            onChange={e => setItemQty(e.target.value)}
            placeholder="Qtd"
            inputMode="numeric"
            className="w-20 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
          <button
            onClick={addItem}
            className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Item
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['auto', 'manual'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                mode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'auto' ? <Zap className="h-3 w-3" /> : <Package className="h-3 w-3" />}
              {m === 'auto' ? 'Melhor preço automático' : 'Manual'}
            </button>
          ))}
        </div>
        {items.length > 0 && (
          <div className="space-y-1 border-t border-border pt-2">
            {items.map(i => (
              <div key={i.name} className="flex items-center gap-2 text-sm bg-secondary/50 rounded-md px-2 py-1.5">
                <span className="flex-1 text-foreground">{i.quantity}x {i.name}</span>
                <button
                  onClick={() => removeItem(i.name)}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={distribute}
            className="flex items-center gap-1 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            <Zap className="h-4 w-4" /> {mode === 'auto' ? 'Distribuir pelo melhor preço' : 'Montar lote manual'}
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground hover:bg-secondary/70"
            title="Atualizar preços"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {fragments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Lote fragmentado em {fragments.length} fornecedor(es) · Total R$ {fmtBRL(totalAll)}
            </p>
            {items.length > 0 && (
              <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground">
                ✕ Novo pedido
              </button>
            )}
          </div>
          {fragments.map((frag, idx) => (
            <div key={idx} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-bold text-foreground">{frag.supplier.name}</p>
                <p className="text-sm font-bold text-primary">R$ {fmtBRL(frag.total)}</p>
              </div>
              <div className="space-y-0.5 text-sm text-muted-foreground">
                {frag.items.map((i, j) => (
                  <div key={j} className="flex justify-between">
                    <span>{i.quantity}x {i.name}</span>
                    <span>R$ {fmtBRL(i.unit_price * i.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => sendWhatsApp(frag)}
                  className="flex items-center gap-1 rounded-lg bg-green-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-green-700"
                >
                  <Send className="h-3.5 w-3.5" /> Enviar WhatsApp
                </button>
                {fragments.length === fragments.length && (
                  <span className="text-[10px] text-muted-foreground self-center">
                    {frag.supplier.phone ? '📞 ' + frag.supplier.phone : '⚠️ sem telefone'}
                  </span>
                )}
              </div>
            </div>
          ))}
          <button
            onClick={() => { saveFragments(); }}
            className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/10"
          >
            💾 Registrar pedidos no histórico (um por fornecedor)
          </button>
        </div>
      )}
    </div>
  );
};

export default SupplierPurchaseSelector;
