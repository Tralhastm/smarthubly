import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProducts } from '@/hooks/useProducts';
import { useAddOrder } from '@/hooks/useOrders';
import { useAddCreditAccount } from '@/hooks/useCredit';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Plus, Minus, Trash2, ShoppingCart, DollarSign, CreditCard, Smartphone, Clock, Printer, Loader2, X, CheckCircle2, ChevronUp, Zap, ChefHat } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type CartItem = { product: Product; quantity: number };
type PayMethod = 'cash' | 'pix' | 'card' | 'fiado';
type SaleMode = 'instant' | 'kitchen'; // instant = entrega na hora; kitchen = vai pra preparo

interface Props {
  tenantId: string;
  printerEnabled?: boolean;
}

const PAY_OPTIONS: { id: PayMethod; label: string; icon: any; color: string }[] = [
  { id: 'cash', label: 'Dinheiro', icon: DollarSign, color: 'green' },
  { id: 'pix', label: 'Pix', icon: Smartphone, color: 'cyan' },
  { id: 'card', label: 'Cartão', icon: CreditCard, color: 'blue' },
  { id: 'fiado', label: 'Fiado', icon: Clock, color: 'orange' },
];

const PAY_COLOR_MAP: Record<string, string> = {
  green: 'border-green-500/50 bg-green-500/10 text-green-400',
  cyan: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400',
  blue: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
  orange: 'border-orange-500/50 bg-orange-500/10 text-orange-400',
};

const TenantQuickSale = ({ tenantId, printerEnabled }: Props) => {
  const { data: products = [], isLoading } = useProducts(tenantId);
  const addOrder = useAddOrder();
  const addCredit = useAddCreditAccount();

  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pay, setPay] = useState<PayMethod>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSale, setLastSale] = useState<{ total: number; change: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false); // bottom sheet mobile
  const [saleMode, setSaleMode] = useState<SaleMode>(() => {
    try { return (localStorage.getItem(`quickSaleMode:${tenantId}`) as SaleMode) || 'instant'; }
    catch { return 'instant'; }
  });

  useEffect(() => {
    try { localStorage.setItem(`quickSaleMode:${tenantId}`, saleMode); } catch { /* ignore */ }
  }, [saleMode, tenantId]);

  const inStock = useMemo(() => products.filter(p => p.in_stock !== false), [products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    inStock.forEach(p => p.category && set.add(p.category));
    return ['all', ...Array.from(set).sort()];
  }, [inStock]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inStock.filter(p => {
      if (activeCat !== 'all' && p.category !== activeCat) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
    });
  }, [inStock, search, activeCat]);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0), [cart]);
  const cashRecvNum = Number(cashReceived.replace(',', '.')) || 0;
  const change = pay === 'cash' && cashRecvNum > subtotal ? cashRecvNum - subtotal : 0;
  const itemsCount = cart.reduce((s, i) => s + i.quantity, 0);

  const addToCart = (p: Product) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.product.id === p.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, { product: p, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.flatMap(i => {
      if (i.product.id !== id) return [i];
      const q = i.quantity + delta;
      return q <= 0 ? [] : [{ ...i, quantity: q }];
    }));
  };

  const removeItem = (id: string) => setCart(prev => prev.filter(i => i.product.id !== id));

  const reset = () => {
    setCart([]); setPay('cash'); setCashReceived('');
    setCustomerName(''); setCustomerPhone(''); setSearch('');
  };

  const printReceipt = async (orderId: string) => {
    if (!printerEnabled) return;
    try {
      const [{ data: order }, { data: tenant }] = await Promise.all([
        supabase.from('orders').select('*, order_items(*)').eq('id', orderId).maybeSingle(),
        supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
      ]);
      if (!order || !tenant) return;
      const { printOrder } = await import('@/lib/order-print');
      await printOrder(order as any, tenant as any);
    } catch (e) {
      console.warn('Print failed', e);
    }
  };

  const handleSubmit = async () => {
    if (cart.length === 0) { toast.error('Adicione produtos ao carrinho'); return; }
    if (pay === 'fiado' && (!customerName.trim() || !customerPhone.trim())) {
      toast.error('Fiado precisa de nome E telefone do cliente');
      return;
    }
    if (pay === 'cash' && cashRecvNum > 0 && cashRecvNum < subtotal) {
      toast.error('Valor recebido menor que o total');
      return;
    }

    setSubmitting(true);
    try {
      const orderData = await addOrder.mutateAsync({
        order: {
          tenant_id: tenantId,
          customer_name: customerName.trim() || 'Venda no balcão',
          customer_phone: customerPhone.trim() || '',
          customer_address: '',
          delivery_type: 'pickup',
          payment_method: pay,
          delivery_fee: 0,
          platform_fee: 0,
          discount_amount: 0,
          change_for: pay === 'cash' && cashRecvNum > 0 ? cashRecvNum : null,
          total: subtotal,
          status: saleMode === 'kitchen' ? 'received' : 'delivered',
          // Em venda no balcão modo "instant" o cliente PAGOU na hora (exceto fiado).
          // Modo "kitchen" começa não pago — lojista confirma quando receber.
          payment_received: pay !== 'fiado' && saleMode === 'instant',
        } as any,
        items: cart.map(i => ({
          product_name: i.product.name,
          product_price: Number(i.product.price),
          quantity: i.quantity,
        })),
      });

      await Promise.all(cart.map(async (i) => {
        const sq = (i.product as any).stock_quantity;
        if (typeof sq === 'number') {
          const newQty = Math.max(0, sq - i.quantity);
          await supabase.from('products').update({
            stock_quantity: newQty,
            in_stock: newQty > 0 ? i.product.in_stock : false,
          }).eq('id', i.product.id);
        }
      }));

      // OBS: a financial_entry para vendas balcão é criada automaticamente
      // pelo hook useAddOrder (modo instant) ou useUpdateOrderStatus (modo
      // kitchen quando o pedido vira "delivered"). Aqui só tratamos o fiado,
      // que NÃO vira receita imediata — vai pra credit_accounts.

      if (pay === 'fiado') {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30);
        await addCredit.mutateAsync({
          tenant_id: tenantId,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_email: '',
          amount: subtotal,
          description: `Venda balcão #${orderData.id.slice(0, 8).toUpperCase()} — ${cart.map(c => `${c.quantity}x ${c.product.name}`).join(', ')}`,
          due_date: dueDate.toISOString(),
          notes: '',
        });
      }

      printReceipt(orderData.id);

      setLastSale({ total: subtotal, change });
      reset();
      setSheetOpen(false);
      const successMsg = saleMode === 'kitchen'
        ? `🍳 Pedido enviado para preparo — R$ ${subtotal.toFixed(2)}`
        : `✅ Venda finalizada — R$ ${subtotal.toFixed(2)}`;
      toast.success(successMsg);
      setTimeout(() => setLastSale(null), 4000);
    } catch (e: any) {
      toast.error(`Erro: ${e.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  // Painel de pagamento (reutilizado em desktop e mobile sheet)
  const PaymentPanel = (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Tipo de venda</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setSaleMode('instant')}
            className={`flex items-center justify-center gap-1.5 rounded-lg border-2 p-2 text-[11px] font-medium transition-all ${
              saleMode === 'instant'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground'
            }`}
          >
            <Zap className="h-3.5 w-3.5" /> Entrega na hora
          </button>
          <button
            onClick={() => setSaleMode('kitchen')}
            className={`flex items-center justify-center gap-1.5 rounded-lg border-2 p-2 text-[11px] font-medium transition-all ${
              saleMode === 'kitchen'
                ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                : 'border-border bg-secondary text-muted-foreground'
            }`}
          >
            <ChefHat className="h-3.5 w-3.5" /> Enviar p/ preparo
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {saleMode === 'instant'
            ? '⚡ Cliente já levou — vai direto para "Entregue".'
            : '🍳 Vai para fila: Recebido → Preparo → Pronto → Entregue.'}
        </p>
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Pagamento</p>
        <div className="grid grid-cols-4 gap-1.5">
          {PAY_OPTIONS.map(o => {
            const Icon = o.icon;
            const active = pay === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setPay(o.id)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 text-[10px] font-medium transition-all ${
                  active ? PAY_COLOR_MAP[o.color] : 'border-border bg-secondary text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {pay === 'cash' && (
        <div>
          <label className="text-xs text-muted-foreground">Valor recebido (opcional)</label>
          <input
            type="text"
            inputMode="decimal"
            value={cashReceived}
            onChange={e => setCashReceived(e.target.value)}
            placeholder={`Ex: ${(Math.ceil(subtotal / 10) * 10).toFixed(2)}`}
            className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          {change > 0 && (
            <div className="mt-1.5 rounded-md bg-green-500/10 border border-green-500/30 px-2 py-1.5 text-xs text-green-400">
              💵 Troco: <span className="font-bold">R$ {change.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {pay === 'fiado' && (
        <div className="space-y-2 rounded-lg border border-orange-500/30 bg-orange-500/5 p-2">
          <p className="text-[10px] text-orange-400">📒 Vai para Fiados (vence em 30 dias)</p>
          <input
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
            placeholder="Nome do cliente *"
            className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none"
          />
          <input
            value={customerPhone}
            onChange={e => setCustomerPhone(e.target.value)}
            placeholder="Telefone *"
            className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none"
          />
        </div>
      )}

      {pay !== 'fiado' && (
        <input
          value={customerName}
          onChange={e => setCustomerName(e.target.value)}
          placeholder="Nome do cliente (opcional)"
          className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none"
        />
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full rounded-xl gradient-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {submitting ? 'Lançando…' : `Finalizar — R$ ${subtotal.toFixed(2)}`}
      </button>
      {printerEnabled && (
        <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
          <Printer className="h-3 w-3" /> Cupom será impresso automaticamente
        </p>
      )}
    </div>
  );

  // Lista de itens do carrinho (reutilizada)
  const CartItems = (
    <div className="space-y-2">
      {cart.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          Toque nos produtos para adicionar
        </div>
      ) : cart.map(i => (
        <div key={i.product.id} className="rounded-lg bg-secondary p-2 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">{i.product.name}</p>
            <p className="text-xs text-muted-foreground">R$ {Number(i.product.price).toFixed(2)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => updateQty(i.product.id, -1)} className="h-7 w-7 rounded-md border border-border bg-card flex items-center justify-center text-foreground active:scale-90">
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-6 text-center text-sm font-bold text-foreground">{i.quantity}</span>
            <button onClick={() => updateQty(i.product.id, 1)} className="h-7 w-7 rounded-md border border-border bg-card flex items-center justify-center text-foreground active:scale-90">
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <span className="text-xs font-bold text-primary w-14 text-right shrink-0">
            R$ {(Number(i.product.price) * i.quantity).toFixed(2)}
          </span>
          <button onClick={() => removeItem(i.product.id)} className="text-destructive p-1 shrink-0">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-4 min-h-[70vh] w-full max-w-full overflow-x-hidden">
      {/* === COLUNA PRODUTOS === */}
      <div className="space-y-3 min-w-0">
        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar produto…"
            className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary outline-none"
          />
        </div>

        {/* Categorias */}
        {categories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all shrink-0 ${
                  activeCat === c ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {c === 'all' ? 'Todos' : c}
              </button>
            ))}
          </div>
        )}

        {/* Grid de produtos COMPACTO — 3 col em mobile, até 6 em desktop */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground text-sm">
            {inStock.length === 0 ? 'Nenhum produto cadastrado.' : 'Nenhum produto encontrado.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-1.5 pb-24 lg:pb-0">
            {filtered.map(p => {
              const inCartQty = cart.find(i => i.product.id === p.id)?.quantity || 0;
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="group relative text-left rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-primary/5 p-1.5 transition-all active:scale-95 min-w-0"
                >
                  {p.image ? (
                    <div className="aspect-square w-full overflow-hidden rounded-md mb-1.5 bg-secondary">
                      <img src={p.image} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  ) : (
                    <div className="aspect-square w-full rounded-md mb-1.5 bg-secondary flex items-center justify-center">
                      <ShoppingCart className="h-5 w-5 text-muted-foreground/40" />
                    </div>
                  )}
                  <p className="text-[11px] leading-tight font-medium text-foreground line-clamp-2 min-h-[1.8rem] break-words">{p.name}</p>
                  <p className="text-xs font-bold text-primary mt-0.5">R$ {Number(p.price).toFixed(2)}</p>
                  {typeof (p as any).stock_quantity === 'number' && (
                    <p className="text-[9px] text-muted-foreground truncate">Est: {(p as any).stock_quantity}</p>
                  )}
                  {inCartQty > 0 && (
                    <div className="absolute top-1 right-1 h-5 min-w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">
                      {inCartQty}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* === CARRINHO DESKTOP (sticky lateral) === */}
      <div className="hidden lg:block">
        <div className="lg:sticky lg:top-20 rounded-xl border border-border bg-card flex flex-col h-[calc(100vh-6rem)]">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <h3 className="font-heading text-sm text-foreground">Carrinho ({itemsCount})</h3>
            </div>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-destructive hover:underline">Limpar</button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">{CartItems}</div>

          {cart.length > 0 && (
            <div className="border-t border-border p-3 space-y-3">
              <div className="rounded-xl gradient-primary p-3 text-primary-foreground">
                <div className="flex items-center justify-between">
                  <span className="text-xs opacity-80">Total</span>
                  <span className="text-2xl font-bold">R$ {subtotal.toFixed(2)}</span>
                </div>
              </div>
              {PaymentPanel}
            </div>
          )}
        </div>
      </div>

      {/* === BOTÃO FLUTUANTE MOBILE (abre bottom sheet) === */}
      {cart.length > 0 && !sheetOpen && createPortal(
        <button
          onClick={() => setSheetOpen(true)}
          className="lg:hidden fixed bottom-4 left-4 right-20 z-[60] gradient-primary text-primary-foreground rounded-2xl px-5 py-3.5 shadow-2xl flex items-center justify-between font-bold animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <div className="relative">
              <ShoppingCart className="h-5 w-5" />
              <span className="absolute -top-2 -right-2 h-5 min-w-5 rounded-full bg-white text-primary text-[10px] font-bold flex items-center justify-center px-1">
                {itemsCount}
              </span>
            </div>
            <span className="text-sm">Ver carrinho</span>
          </div>
          <div className="flex items-center gap-2">
            <span>R$ {subtotal.toFixed(2)}</span>
            <ChevronUp className="h-4 w-4" />
          </div>
        </button>,
        document.body
      )}


      {/* === BOTTOM SHEET MOBILE === */}
      {sheetOpen && createPortal(
        <>
          <div
            onClick={() => setSheetOpen(false)}
            className="lg:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm animate-fade-in"
          />
          <div className="lg:hidden fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl border-t border-border bg-card max-h-[88vh] flex flex-col" style={{ animation: 'slideUp 0.25s ease-out' }}>
            <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

            {/* Handle */}
            <div className="flex justify-center pt-2 pb-1 shrink-0">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-2 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <h3 className="font-heading text-sm text-foreground">Carrinho ({itemsCount})</h3>
              </div>
              <div className="flex items-center gap-3">
                {cart.length > 0 && (
                  <button onClick={() => setCart([])} className="text-xs text-destructive">Limpar</button>
                )}
                <button onClick={() => setSheetOpen(false)} className="text-muted-foreground p-1">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Itens (scroll) */}
            <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
              {CartItems}
            </div>

            {/* Pagamento + total fixo no fundo */}
            {cart.length > 0 && (
              <div className="border-t border-border p-3 space-y-3 shrink-0 bg-card">
                <div className="rounded-xl gradient-primary p-3 text-primary-foreground">
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-80">Total</span>
                    <span className="text-2xl font-bold">R$ {subtotal.toFixed(2)}</span>
                  </div>
                </div>
                {PaymentPanel}
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Toast de sucesso */}
      {lastSale && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in px-4 max-w-[calc(100vw-2rem)]">
          <div className="rounded-2xl border border-green-500/50 bg-green-500/20 backdrop-blur-md px-6 py-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-green-400 font-medium">Venda finalizada!</p>
                <p className="text-lg font-bold text-foreground">R$ {lastSale.total.toFixed(2)}</p>
                {lastSale.change > 0 && (
                  <p className="text-xs text-green-400">Troco: R$ {lastSale.change.toFixed(2)}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantQuickSale;
