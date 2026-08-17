import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Plus, Minus, Search, Send, Copy, X, ShoppingBag, BookOpen, ArrowRightLeft } from 'lucide-react';
import TableActionsDialog from './TableActionsDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  session: any;
  tenantId: string;
}

interface Product { id: string; name: string; price: number; image: string | null; category: string | null; }
interface Item { id: string; product_name: string; product_price: number; quantity: number; notes: string; }

export default function WaiterComandaEditor({ open, onClose, session, tenantId }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [tab, setTab] = useState<'menu' | 'comanda'>('menu');
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('Todos');
  const [customerName, setCustomerName] = useState(session?.customer_name || '');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const isSent = session?.status === 'sent';
  const orderId = session?.order_id || null;
  // Contador de mutações pendentes pra evitar que o realtime sobrescreva
  // estado otimista com snapshot velho (causa de "item excluído voltando").
  const pendingMutations = useState({ count: 0 })[0];

  // Quando comanda já foi enviada, sincroniza alterações de itens com o pedido
  // existente pra cozinha/central enxergar a versão mais nova.
  const syncSentOrder = async (newItems: Item[], newTotal: number) => {
    if (!isSent || !orderId) return;
    try {
      setSyncing(true);
      await supabase.from('order_items').delete().eq('order_id', orderId);
      if (newItems.length > 0) {
        await supabase.from('order_items').insert(newItems.map(i => ({
          order_id: orderId, product_name: i.product_name,
          product_price: i.product_price, quantity: i.quantity, notes: i.notes || null,
        })));
      }
      await supabase.from('orders').update({ total: newTotal, updated_at: new Date().toISOString() } as any).eq('id', orderId);
    } catch (e) { console.warn('sync sent order failed', e); }
    finally { setSyncing(false); }
  };

  useEffect(() => {
    if (!open || !session) return;
    setCustomerName(session.customer_name || '');
    (async () => {
      const [{ data: prods }, { data: itms }] = await Promise.all([
        supabase.from('products').select('id,name,price,image,category')
          .eq('tenant_id', tenantId).eq('in_stock', true).order('category'),
        (supabase as any).from('table_session_items').select('*')
          .eq('session_id', session.id).order('created_at'),
      ]);
      setProducts((prods as any) || []);
      setItems(itms || []);
    })();
  }, [open, session, tenantId]);

  // Realtime para refletir alterações se o cliente também estiver vendo.
  // Só refetch quando NÃO houver mutações locais pendentes — caso contrário
  // o snapshot do servidor pode estar atrás do estado otimista e "ressuscitar"
  // itens recém-excluídos.
  useEffect(() => {
    if (!open || !session?.id) return;
    const ch = (supabase as any).channel(`wedit-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_session_items', filter: `session_id=eq.${session.id}` }, async () => {
        if (pendingMutations.count > 0) return;
        const { data } = await (supabase as any).from('table_session_items').select('*').eq('session_id', session.id).order('created_at');
        setItems(data || []);
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [open, session?.id]);

  const total = useMemo(() => items.reduce((s, i) => s + Number(i.product_price) * i.quantity, 0), [items]);
  const itemCount = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => p.category && set.add(p.category));
    return ['Todos', ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => products.filter(p => {
    if (activeCat !== 'Todos' && p.category !== activeCat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [products, activeCat, search]);

  const addProduct = async (p: Product) => {
    pendingMutations.count++;
    try {
      const existing = items.find(i => i.product_name === p.name && !i.notes && !i.id.startsWith('tmp-'));
      let nextItems: Item[] = items;
      if (existing) {
        const newQty = existing.quantity + 1;
        nextItems = items.map(i => i.id === existing.id ? { ...i, quantity: newQty } : i);
        setItems(nextItems);
        const { error } = await (supabase as any).from('table_session_items').update({ quantity: newQty }).eq('id', existing.id);
        if (error) { toast.error('Não salvou: ' + error.message); throw error; }
      } else {
        // Insere PRIMEIRO no DB pra obter id real — evita orphan caso o
        // garçom remova o item antes do insert voltar.
        const { data: inserted, error } = await (supabase as any).from('table_session_items').insert({
          session_id: session.id, tenant_id: tenantId,
          product_id: p.id, product_name: p.name, product_price: p.price,
          quantity: 1, added_by: 'waiter',
        }).select().single();
        if (error || !inserted) { toast.error('Não salvou: ' + (error?.message || 'erro')); throw error; }
        nextItems = [...items, { id: inserted.id, product_name: p.name, product_price: p.price, quantity: 1, notes: '' }];
        setItems(nextItems);
      }
      const newTotal = nextItems.reduce((s, i) => s + Number(i.product_price) * i.quantity, 0);
      await (supabase as any).from('table_sessions').update({ total: newTotal }).eq('id', session.id);
      await syncSentOrder(nextItems, newTotal);
    } finally { pendingMutations.count = Math.max(0, pendingMutations.count - 1); }
  };

  const updateQty = async (item: Item, delta: number) => {
    if (item.id.startsWith('tmp-')) return; // ainda sendo inserido
    pendingMutations.count++;
    try {
      const newQty = item.quantity + delta;
      let nextItems: Item[];
      if (newQty <= 0) {
        nextItems = items.filter(i => i.id !== item.id);
        setItems(nextItems);
        const { error } = await (supabase as any).from('table_session_items').delete().eq('id', item.id);
        if (error) {
          toast.error('Não removeu: ' + error.message);
          setItems(items); // reverte
          throw error;
        }
      } else {
        nextItems = items.map(i => i.id === item.id ? { ...i, quantity: newQty } : i);
        setItems(nextItems);
        const { error } = await (supabase as any).from('table_session_items').update({ quantity: newQty }).eq('id', item.id);
        if (error) {
          toast.error('Não atualizou: ' + error.message);
          setItems(items);
          throw error;
        }
      }
      const newTotal = nextItems.reduce((s, i) => s + Number(i.product_price) * i.quantity, 0);
      await (supabase as any).from('table_sessions').update({ total: newTotal }).eq('id', session.id);
      await syncSentOrder(nextItems, newTotal);
    } finally { pendingMutations.count = Math.max(0, pendingMutations.count - 1); }
  };

  const sendToKitchen = async () => {
    if (items.length === 0) { toast.error('Adicione itens primeiro'); return; }
    setSending(true);
    try {
      await (supabase as any).from('table_sessions').update({
        customer_name: customerName.trim() || session.customer_name || '',
      }).eq('id', session.id);

      const { data: order, error } = await supabase.from('orders').insert({
        tenant_id: tenantId,
        total, platform_fee: 0,
        delivery_type: 'pickup', delivery_fee: 0,
        payment_method: 'mesa',
        customer_name: customerName.trim() || 'Cliente',
        customer_phone: '', customer_address: session.table_label,
        status: 'received',
        table_session_id: session.id,
        table_label: session.table_label,
      } as any).select().single();
      if (error) throw error;

      await supabase.from('order_items').insert(items.map(i => ({
        order_id: order.id, product_name: i.product_name,
        product_price: i.product_price, quantity: i.quantity, notes: i.notes || null,
      })));

      await (supabase as any).from('table_sessions').update({
        status: 'sent', sent_at: new Date().toISOString(), order_id: order.id,
      }).eq('id', session.id);

      toast.success('Comanda enviada à cozinha!');
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao enviar');
    } finally { setSending(false); }
  };

  const copyCode = () => {
    if (!session?.share_code) return;
    navigator.clipboard.writeText(session.share_code);
    toast.success('Código copiado!');
  };

  if (!session) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 h-[92vh] flex flex-col gap-0 overflow-hidden">
        {/* Header com código compartilhável */}
        <div className="bg-primary text-primary-foreground p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="font-bold text-lg">{session.table_label}</div>
              <div className="text-xs opacity-90">Comanda do garçom</div>
            </div>
            <Button size="icon" variant="ghost" className="text-primary-foreground hover:bg-white/10" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {session.share_code && (
            <div className="bg-white/10 rounded p-2 flex items-center gap-2">
              <div className="flex-1">
                <div className="text-[10px] uppercase opacity-80">Código pro cliente ver</div>
                <div className="text-2xl font-mono font-bold tracking-widest">{session.share_code}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={copyCode}>
                <Copy className="h-3 w-3 mr-1" /> Copiar
              </Button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button onClick={() => setTab('menu')} className={`flex-1 py-2 text-sm font-medium ${tab === 'menu' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>
            <BookOpen className="inline h-4 w-4 mr-1" /> Cardápio
          </button>
          <button onClick={() => setTab('comanda')} className={`flex-1 py-2 text-sm font-medium ${tab === 'comanda' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>
            <ShoppingBag className="inline h-4 w-4 mr-1" /> Itens ({itemCount})
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {tab === 'menu' && (
            <>
              <div className="p-2 space-y-2 border-b">
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                  <Input placeholder="Buscar produto" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <ScrollArea className="w-full">
                  <div className="flex gap-2 pb-1">
                    {categories.map(c => (
                      <Button key={c} size="sm" variant={activeCat === c ? 'default' : 'outline'} onClick={() => setActiveCat(c)} className="shrink-0">{c}</Button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-2 grid grid-cols-2 gap-2 auto-rows-min content-start">
                {filtered.map(p => (
                  <Card key={p.id} className="overflow-hidden flex flex-col min-h-[170px]">
                    {p.image && <img src={p.image} alt={p.name} className="w-full h-20 object-cover" />}
                    <div className="p-2 flex-1 flex flex-col gap-1">
                      <div className="text-xs font-medium line-clamp-2">{p.name}</div>
                      <div className="text-primary font-bold text-sm">R$ {Number(p.price).toFixed(2)}</div>
                      <Button size="sm" className="mt-auto h-7 text-xs" onClick={() => addProduct(p)}>
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
          {tab === 'comanda' && (
            <div className="flex-1 overflow-auto p-2 space-y-2">
              {isSent && (
                <Card className="p-2 border-primary/40 bg-primary/5 text-xs">
                  ✓ Comanda já enviada à cozinha. Alterações são sincronizadas automaticamente com o pedido. {syncing && <span className="opacity-60">(sincronizando...)</span>}
                </Card>
              )}
              <Card className="p-2">
                <div className="text-xs text-muted-foreground mb-1">Nome do cliente (opcional)</div>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Ex: Mesa do João" />
              </Card>
              {items.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">Nenhum item ainda. Vá no cardápio.</div>
              ) : items.map(i => (
                <Card key={i.id} className="p-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{i.product_name}</div>
                    <div className="text-xs text-muted-foreground">R$ {Number(i.product_price).toFixed(2)} • R$ {(Number(i.product_price) * i.quantity).toFixed(2)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i, -1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 text-center font-bold text-sm">{i.quantity}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i, 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-2 bg-card space-y-1">
          <div className="flex justify-between font-bold text-sm">
            <span>Total</span><span className="text-primary">R$ {total.toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setActionsOpen(true)}>
              <ArrowRightLeft className="h-4 w-4 mr-1" /> Mesa
            </Button>
            {isSent ? (
              <div className="flex-1 text-xs text-center text-primary py-2">
                ✓ Enviado à cozinha {syncing && <span className="opacity-60">(sincronizando…)</span>}
              </div>
            ) : (
              <Button className="flex-1" disabled={sending || items.length === 0} onClick={sendToKitchen}>
                <Send className="h-4 w-4 mr-1" /> {sending ? 'Enviando...' : 'Enviar para cozinha'}
              </Button>
            )}
          </div>
        </div>
        <TableActionsDialog open={actionsOpen} onClose={() => setActionsOpen(false)} session={session} tenantId={tenantId} />
      </DialogContent>
    </Dialog>
  );
}

