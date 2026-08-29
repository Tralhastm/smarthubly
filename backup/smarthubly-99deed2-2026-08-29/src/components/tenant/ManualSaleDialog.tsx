import { useEffect, useMemo, useState } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { useAddOrder } from '@/hooks/useOrders';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Minus, Trash2, Search, ShoppingCart, Zap, ChefHat } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_METHODS } from '@/lib/payment-method';

type CartItem = { product_name: string; product_price: number; quantity: number };
type SaleMode = 'instant' | 'kitchen';

interface Props {
  tenantId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const PAY_METHODS = PAYMENT_METHODS.filter(m => m.value !== 'mercadopago' && m.value !== 'fiado');

const ManualSaleDialog = ({ tenantId, open, onOpenChange }: Props) => {
  const { data: products = [] } = useProducts(tenantId);
  const addOrder = useAddOrder();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('dinheiro');
  const [extraTotal, setExtraTotal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saleMode, setSaleMode] = useState<SaleMode>(() => {
    try { return (localStorage.getItem(`manualSaleMode:${tenantId}`) as SaleMode) || 'instant'; }
    catch { return 'instant'; }
  });

  useEffect(() => {
    try { localStorage.setItem(`manualSaleMode:${tenantId}`, saleMode); } catch { /* ignore */ }
  }, [saleMode, tenantId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inStock = products.filter(p => p.in_stock !== false);
    if (!q) return inStock;
    return inStock.filter(p => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
  }, [products, search]);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.product_price * i.quantity, 0), [cart]);
  const extra = Number(extraTotal.replace(',', '.')) || 0;
  const total = subtotal + extra;

  const addToCart = (name: string, price: number) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.product_name === name);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, { product_name: name, product_price: price, quantity: 1 }];
    });
  };

  const updateQty = (name: string, delta: number) => {
    setCart(prev => prev.flatMap(i => {
      if (i.product_name !== name) return [i];
      const q = i.quantity + delta;
      return q <= 0 ? [] : [{ ...i, quantity: q }];
    }));
  };

  const removeItem = (name: string) => setCart(prev => prev.filter(i => i.product_name !== name));

  const reset = () => {
    setSearch(''); setCart([]); setCustomerName(''); setCustomerPhone('');
    setPaymentMethod('dinheiro'); setExtraTotal('');
  };

  const handleSubmit = async () => {
    if (cart.length === 0 && extra <= 0) {
      toast.error('Adicione ao menos um item ou um valor avulso');
      return;
    }
    if (total <= 0) {
      toast.error('O total precisa ser maior que zero');
      return;
    }
    setSubmitting(true);
    try {
      const items = cart.length > 0
        ? cart
        : [{ product_name: 'Venda avulsa', product_price: extra, quantity: 1 }];

      // Se tem itens E valor extra, adiciona como item "Acréscimo"
      const finalItems = (cart.length > 0 && extra > 0)
        ? [...cart, { product_name: 'Acréscimo / Avulso', product_price: extra, quantity: 1 }]
        : items;

      await addOrder.mutateAsync({
        order: {
          tenant_id: tenantId,
          customer_name: customerName.trim() || 'Venda no balcão',
          customer_phone: customerPhone.trim() || '',
          customer_address: '',
          delivery_type: 'pickup',
          payment_method: paymentMethod,
          delivery_fee: 0,
          platform_fee: 0,
          discount_amount: 0,
          total,
          status: saleMode === 'kitchen' ? 'received' : 'delivered',
        } as any,
        items: finalItems,
      });
      const successMsg = saleMode === 'kitchen'
        ? `🍳 Pedido enviado para preparo — R$ ${total.toFixed(2)}`
        : `✅ Venda lançada — R$ ${total.toFixed(2)}`;
      toast.success(successMsg);
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Erro ao lançar venda: ${e.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" /> Lançar venda no balcão
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Para vendas presenciais. {saleMode === 'instant'
              ? 'Já entra como entregue e conta no faturamento.'
              : 'Vai pra fila de preparo (Recebido → Preparo → Pronto → Entregue).'}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Modo de venda */}
          <div>
            <Label className="text-xs">Tipo de venda</Label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setSaleMode('instant')}
                className={`flex items-center justify-center gap-1.5 rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors ${
                  saleMode === 'instant'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                <Zap className="h-3.5 w-3.5" /> Entrega na hora
              </button>
              <button
                onClick={() => setSaleMode('kitchen')}
                className={`flex items-center justify-center gap-1.5 rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors ${
                  saleMode === 'kitchen'
                    ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                    : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                <ChefHat className="h-3.5 w-3.5" /> Enviar p/ preparo
              </button>
            </div>
          </div>

          {/* Busca de produtos */}
          <div>
            <Label className="text-xs">Adicionar produto do catálogo</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou categoria…"
                className="pl-9"
              />
            </div>
            {filtered.length > 0 && (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                {filtered.map(p => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p.name, Number(p.price))}
                    className="text-left rounded-lg border border-border bg-secondary hover:bg-secondary/70 p-2 transition-colors"
                  >
                    <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-primary font-bold">R$ {Number(p.price).toFixed(2)}</p>
                  </button>
                ))}
              </div>
            )}
            {!search && filtered.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">{filtered.length} produto(s) — role pra ver todos</p>
            )}
            {search && filtered.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">Nenhum produto encontrado.</p>
            )}
          </div>

          {/* Carrinho */}
          {cart.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Itens ({cart.length})</p>
              {cart.map(item => (
                <div key={item.product_name} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">R$ {item.product_price.toFixed(2)} un</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(item.product_name, -1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(item.product_name, 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <span className="text-sm font-bold text-primary w-20 text-right">
                    R$ {(item.product_price * item.quantity).toFixed(2)}
                  </span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(item.product_name)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Valor extra (avulso) */}
          <div>
            <Label htmlFor="extra" className="text-xs">Valor avulso (sem catálogo)</Label>
            <Input
              id="extra"
              type="text"
              inputMode="decimal"
              value={extraTotal}
              onChange={(e) => setExtraTotal(e.target.value)}
              placeholder="Ex: 25,00 — útil pra produtos não cadastrados"
              className="mt-1"
            />
          </div>

          {/* Cliente */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="cname" className="text-xs">Cliente (opcional)</Label>
              <Input id="cname" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Balcão" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="cphone" className="text-xs">Telefone (opcional)</Label>
              <Input id="cphone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="—" className="mt-1" />
            </div>
          </div>

          {/* Pagamento */}
          <div>
            <Label className="text-xs">Forma de pagamento</Label>
            <div className="mt-1 grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {PAY_METHODS.map(m => (
                <button
                  key={m.value}
                  onClick={() => setPaymentMethod(m.value)}
                  className={`text-xs rounded-md border px-2 py-2 transition-colors ${
                    paymentMethod === m.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total da venda</p>
              <p className="text-2xl font-bold text-primary">R$ {total.toFixed(2)}</p>
            </div>
            {cart.length > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">{cart.reduce((s, i) => s + i.quantity, 0)} item(ns)</p>
                {extra > 0 && <p className="text-[10px] text-muted-foreground">+ avulso R$ {extra.toFixed(2)}</p>}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting || total <= 0}>
            {submitting ? 'Lançando…' : `Lançar venda — R$ ${total.toFixed(2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualSaleDialog;
