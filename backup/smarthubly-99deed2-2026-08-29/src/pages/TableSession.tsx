import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Minus, ShoppingBag, Search, CheckCircle2, ArrowLeft, BellRing, UserCircle2 } from 'lucide-react';
import { deriveBrandTokens, applyBrandTokens, clearBrandTokens } from '@/lib/color-utils';
import MediaCarousel from '@/components/shared/MediaCarousel';

interface Product {
  id: string; name: string; price: number; image: string | null;
  media?: { type: 'image' | 'video'; url: string }[] | null;
  category: string | null; in_stock: boolean;
}
interface SessionItem {
  id: string; product_name: string; product_price: number; quantity: number; notes: string;
}

const QUICK_REQUESTS = [
  'Trazer a conta',
  'Mais guardanapos',
  'Mais gelo',
  'Mais cerveja',
  'Talheres',
  'Trocar prato',
];

export default function TableSession() {
  const { slug, code } = useParams<{ slug: string; code: string }>();
  const [searchParams] = useSearchParams();
  const waiterToken = searchParams.get('w');
  const [tenant, setTenant] = useState<any>(null);
  const [table, setTable] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'menu' | 'comanda' | 'ajuda'>('menu');
  const [sending, setSending] = useState(false);
  const [activeCat, setActiveCat] = useState('Todos');
  const [requestMsg, setRequestMsg] = useState('');
  const [openRequests, setOpenRequests] = useState<any[]>([]);
  const [codeInput, setCodeInput] = useState(searchParams.get('c') || '');
  const [codeOk, setCodeOk] = useState(false);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);

  // Aplica tema da loja
  useEffect(() => {
    if (!tenant) return;
    const primary = tenant.brand_primary_color || '#3B82F6';
    const bg = tenant.brand_bg_color || '#FFFFFF';
    const root = document.documentElement;
    const tokens = deriveBrandTokens(primary, bg);
    applyBrandTokens(root, tokens);
    root.classList.remove('dark');
    return () => clearBrandTokens(root, Object.keys(tokens));
  }, [tenant]);

  // Cliente em modo leitura abre direto a comanda
  useEffect(() => {
    if (codeOk && session?.share_code) setView('comanda');
  }, [codeOk, session?.share_code]);

  // Boot
  useEffect(() => {
    const init = async () => {
      if (!slug || !code) return;
      const { data: tab } = await (supabase as any)
        .from('restaurant_tables').select('*').eq('code', code).maybeSingle();
      if (!tab) { setLoading(false); return; }
      const { data: tn } = await (supabase as any).from('tenants_public').select('*').eq('id', tab.tenant_id).maybeSingle();
      setTable(tab); setTenant(tn);

      // Acha sessão aberta ou enviada
      const { data: existing } = await (supabase as any)
        .from('table_sessions').select('*')
        .eq('table_id', tab.id).in('status', ['open', 'sent']).maybeSingle();
      let s = existing;

      // Se não existe, cliente abre automaticamente (caminho A)
      if (!s) {
        const { data: created, error: errCreate } = await (supabase as any).from('table_sessions').insert({
          tenant_id: tab.tenant_id,
          table_id: tab.id,
          table_label: tab.label,
          customer_name: '',
          opened_by: 'customer',
        }).select().single();
        if (errCreate) { toast.error(errCreate.message); setLoading(false); return; }
        s = created;
        setCodeOk(true); // cliente é dono
      }
      setSession(s);
      setCustomerName(s?.customer_name || '');

      // Se já veio com código na URL e bate, libera leitura
      const initialCode = searchParams.get('c');
      if (s.share_code && initialCode && initialCode.toUpperCase() === s.share_code) {
        setCodeOk(true);
      } else if (!s.share_code) {
        // Sessão legada (sem código) — libera por compatibilidade
        setCodeOk(true);
      }

      const { data: prods } = await supabase.from('products').select('id,name,price,image,media,category,in_stock')
        .eq('tenant_id', tab.tenant_id).eq('in_stock', true).order('category');
      setProducts(prods || []);

      const { data: itms } = await (supabase as any).from('table_session_items')
        .select('*').eq('session_id', s.id).order('created_at');
      setItems(itms || []);

      const { data: reqs } = await (supabase as any).rpc('list_service_requests_for_session', { _session_id: s.id });
      setOpenRequests(reqs || []);

      setLoading(false);
    };
    init();
  }, [slug, code]);

  // Realtime
  useEffect(() => {
    if (!session?.id) return;
    const ch = (supabase as any).channel(`tsess-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_session_items', filter: `session_id=eq.${session.id}` }, async () => {
        const { data } = await (supabase as any).from('table_session_items').select('*').eq('session_id', session.id).order('created_at');
        setItems(data || []);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: `id=eq.${session.id}` }, (p: any) => setSession(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests', filter: `session_id=eq.${session.id}` }, async () => {
        const { data } = await (supabase as any).rpc('list_service_requests_for_session', { _session_id: session.id });
        setOpenRequests(data || []);
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [session?.id]);

  // Status do pedido (quando comanda já foi enviada)
  useEffect(() => {
    const oid = session?.order_id;
    if (!oid) { setOrderStatus(null); return; }
    let active = true;
    // A ordem foi arquivada/finalizada pela loja (deletada do banco). Não é
    // cancelamento: o cliente pode montar uma nova comanda normalmente.
    const closedSession = () => {
      setOrderStatus(null);
      setItems([]);
      setSession((prev: any) => prev ? { ...prev, order_id: null, status: 'open', sent_at: null } : prev);
    };
    // A loja cancelou o pedido ativamente — avisar o cliente.
    const cancelledSession = () => {
      setOrderStatus(null);
      setItems([]);
      setSession((prev: any) => prev ? { ...prev, order_id: null, status: 'open', sent_at: null } : prev);
      toast.warning('O pedido foi cancelado pela loja. Você pode montar uma nova comanda.', { duration: 8000 });
    };
    (async () => {
      const { data } = await supabase.from('orders').select('status').eq('id', oid).maybeSingle();
      if (!active) return;
      if (!data) { closedSession(); return; } // arquivada/finalizada, não cancelada
      setOrderStatus((data as any).status);
      if ((data as any).status === 'cancelled') cancelledSession();
    })();
    const ch = (supabase as any).channel(`order-${oid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${oid}` }, (p: any) => {
        setOrderStatus(p.new.status);
        if (p.new.status === 'cancelled') cancelledSession();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders', filter: `id=eq.${oid}` }, () => {
        closedSession(); // pedido finalizado/arquivado pela loja
      })
      .subscribe();
    return () => { active = false; (supabase as any).removeChannel(ch); };
  }, [session?.order_id]);

  const total = useMemo(() => items.reduce((s, i) => s + i.product_price * i.quantity, 0), [items]);
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

  const addProduct = (p: Product) => {
    if (!session) return;
    const existing = items.find(i => i.product_name === p.name && !i.notes);
    // Optimistic UI update — sem esperar rede
    if (existing) {
      setItems(prev => prev.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      const tempId = `tmp-${Date.now()}-${Math.random()}`;
      setItems(prev => [...prev, { id: tempId, product_name: p.name, product_price: p.price, quantity: 1, notes: '' }]);
    }
    toast.success(`+ ${p.name}`, { duration: 1000 });
    // Fire-and-forget no banco; realtime reconcilia
    (async () => {
      if (existing && !existing.id.startsWith('tmp-')) {
        await (supabase as any).from('table_session_items').update({ quantity: existing.quantity + 1 }).eq('id', existing.id);
      } else {
        await (supabase as any).from('table_session_items').insert({
          session_id: session.id, tenant_id: session.tenant_id,
          product_id: p.id, product_name: p.name, product_price: p.price,
          quantity: 1, added_by: 'customer',
        });
      }
      (supabase as any).from('table_sessions').update({ total: total + p.price }).eq('id', session.id);
    })();
  };

  const updateQty = (item: SessionItem, delta: number) => {
    const newQty = item.quantity + delta;
    // Optimistic
    if (newQty <= 0) {
      setItems(prev => prev.filter(i => i.id !== item.id));
    } else {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i));
    }
    (async () => {
      if (item.id.startsWith('tmp-')) return;
      if (newQty <= 0) {
        await (supabase as any).from('table_session_items').delete().eq('id', item.id);
      } else {
        await (supabase as any).from('table_session_items').update({ quantity: newQty }).eq('id', item.id);
      }
      (supabase as any).from('table_sessions').update({ total: total + item.product_price * delta }).eq('id', session.id);
    })();
  };

  const callWaiter = async (msg: string) => {
    if (!session) return;
    const text = (msg || requestMsg).trim() || 'Cliente solicitou atendimento';
    const { error } = await (supabase as any).from('service_requests').insert({
      tenant_id: session.tenant_id,
      session_id: session.id,
      table_id: table.id,
      table_label: table.label,
      waiter_id: session.assigned_waiter_id,
      customer_name: customerName || session.customer_name || '',
      message: text,
      status: 'open',
    });
    if (error) { toast.error(error.message); return; }
    setRequestMsg('');
    toast.success(session.assigned_waiter_name ? `${session.assigned_waiter_name} foi avisado!` : 'Garçom avisado!');
  };

  const finalizeOrder = async () => {
    if (!session || items.length === 0) return;
    if (!customerName.trim()) { toast.error('Coloque seu nome'); return; }
    setSending(true);
    try {
      await (supabase as any).from('table_sessions').update({ customer_name: customerName.trim() }).eq('id', session.id);
      // Usa a RPC place_order (Security Definer, com grant explícito ao anon),
      // o mesmo canal seguro usado pelo painel e pelo PDV — insert direto na
      // tabela orders é bloqueado pelas regras de permissão do banco.
      const orderItems = items.map(i => ({
        product_name: i.product_name,
        product_price: i.product_price,
        quantity: i.quantity,
        notes: i.notes || null,
      }));
      const { data: orderId, error } = await (supabase as any).rpc('place_order', {
        _order: {
          tenant_id: session.tenant_id,
          total,
          platform_fee: 0,
          delivery_type: 'pickup',
          delivery_fee: 0,
          payment_method: 'mesa',
          customer_name: customerName.trim(),
          customer_phone: '',
          customer_address: `${table.label}`,
          status: 'received',
          table_session_id: session.id,
          table_label: table.label,
        },
        _items: orderItems,
      });
      if (error || !orderId) throw new Error(error?.message || 'Erro ao gravar a comanda');
      const orderIdStr = String(orderId);
      await (supabase as any).from('table_sessions').update({
        status: 'sent', sent_at: new Date().toISOString(), order_id: orderIdStr,
      }).eq('id', session.id);
      toast.success('Comanda enviada para a cozinha!');
      setSession({ ...session, status: 'sent' });
    } catch (e: any) {
      toast.error(e.message || 'Erro ao enviar');
    } finally { setSending(false); }
  };

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!table || !tenant) return <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center text-foreground">QR code inválido. Peça ajuda ao garçom.</div>;

  if (session?.status === 'paid') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle2 className="h-20 w-20 text-primary mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Pagamento confirmado</h1>
        <p className="text-muted-foreground">Obrigado pela visita!</p>
      </div>
    );
  }

  // (sessão é auto-criada acima — não há mais tela "abrir comanda")

  // Sessão tem código mas o cliente ainda não digitou
  if (session.owner_device_id && session.share_code && !codeOk) {
    const tryCode = () => {
      if (codeInput.trim().toUpperCase() === session.share_code) {
        setCodeOk(true);
      } else {
        toast.error('Código incorreto');
      }
    };
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        {tenant.logo_url && <img src={tenant.logo_url} className="h-14 w-14 rounded-full object-cover border" alt="" />}
        <h1 className="text-xl font-bold text-foreground">{tenant.name}</h1>
        <Badge>{table.label}</Badge>
        <Card className="p-4 w-full max-w-xs space-y-3">
          <div className="text-sm text-muted-foreground">Digite o código de acesso que o garçom te passou:</div>
          <Input
            autoFocus
            value={codeInput}
            onChange={e => setCodeInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && tryCode()}
            placeholder="ABC123"
            className="text-center text-2xl font-mono tracking-widest h-14"
            maxLength={6}
          />
          <Button className="w-full" onClick={tryCode}>Acessar comanda</Button>
        </Card>
      </div>
    );
  }

  const isSent = session?.status === 'sent';
  // Cliente é read-only só quando a comanda foi aberta pelo garçom (tem owner_device_id)
  const readOnly = !!session?.owner_device_id;
  const locked = isSent || readOnly;

  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
        <div className="p-3 flex items-center gap-2">
          {tenant.logo_url && <img src={tenant.logo_url} className="h-10 w-10 rounded-full object-cover border" alt="" />}
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{tenant.name}</div>
            <div className="flex items-center gap-1 flex-wrap">
              <Badge variant="secondary" className="text-xs">{table.label}</Badge>
              {session?.assigned_waiter_name && (
                <Badge variant="outline" className="text-xs gap-1">
                  <UserCircle2 className="h-3 w-3" /> {session.assigned_waiter_name}
                </Badge>
              )}
            </div>
          </div>
          <Button size="sm" variant={view === 'comanda' ? 'default' : 'outline'} onClick={() => setView(view === 'comanda' ? 'menu' : 'comanda')}>
            <ShoppingBag className="h-4 w-4 mr-1" /> {itemCount}
          </Button>
        </div>
        <div className="flex border-t">
          {!locked && (
            <button onClick={() => setView('menu')} className={`flex-1 py-2 text-sm font-medium transition-colors ${view === 'menu' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>Cardápio</button>
          )}
          <button onClick={() => setView('comanda')} className={`flex-1 py-2 text-sm font-medium transition-colors ${view === 'comanda' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>Comanda {itemCount > 0 && <span className="text-xs">({itemCount})</span>}</button>
          <button onClick={() => setView('ajuda')} className={`flex-1 py-2 text-sm font-medium transition-colors relative ${view === 'ajuda' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>
            Chamar garçom
            {openRequests.length > 0 && <span className="absolute top-1 right-1/4 h-2 w-2 rounded-full bg-primary animate-pulse" />}
          </button>
        </div>
      </header>

      {readOnly && !isSent && (
        <div className="p-2 bg-muted/50 border-b text-xs text-center text-muted-foreground">
          👁️ Modo visualização — só o garçom pode editar a comanda.
        </div>
      )}

      {isSent && (
        <div className="p-3 bg-primary/10 border-b text-sm text-center space-y-2">
          <div>
            <CheckCircle2 className="inline h-4 w-4 mr-1 text-primary" />
            Comanda enviada à cozinha. {session?.assigned_waiter_name && <>Garçom: <strong>{session.assigned_waiter_name}</strong></>}
          </div>
          {orderStatus && (() => {
            const steps: { key: string; label: string }[] = [
              { key: 'received', label: 'Recebido' },
              { key: 'preparing', label: 'Preparando' },
              { key: 'ready-for-pickup', label: 'Pronto' },
              { key: 'delivered', label: 'Entregue' },
            ];
            const idx = steps.findIndex(s => s.key === orderStatus);
            const current = idx >= 0 ? idx : 0;
            return (
              <div className="flex items-center justify-between gap-1 pt-1">
                {steps.map((s, i) => (
                  <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`h-2 w-full rounded-full ${i <= current ? 'bg-primary' : 'bg-muted'}`} />
                    <span className={`text-[10px] ${i === current ? 'font-bold text-primary' : 'text-muted-foreground'}`}>{s.label}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="text-xs text-muted-foreground">
            Para alterar a comanda, chame o garçom na aba "Chamar garçom".
          </div>
        </div>
      )}

      {view === 'menu' && !locked && (
        <>
          <div className="p-3 space-y-2 border-b bg-card/50">
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
          <div className="flex-1 overflow-auto p-3 grid grid-cols-2 gap-3 pb-32">
            {filtered.map(p => (
              <Card key={p.id} className="overflow-hidden flex flex-col hover:border-primary/50 transition-colors">
                {Array.isArray(p.media) && p.media.length > 0 ? (
                  <MediaCarousel items={p.media} className="w-full h-28" imgClassName="w-full h-28 object-cover" videoClassName="w-full h-28 object-cover" />
                ) : (
                  p.image && <img src={p.image} alt={p.name} className="w-full h-28 object-cover" />
                )}
                <div className="p-2 flex-1 flex flex-col gap-1">
                  <div className="text-sm font-medium line-clamp-2">{p.name}</div>
                  <div className="text-primary font-bold">R$ {p.price.toFixed(2)}</div>
                  <Button size="sm" className="mt-auto" onClick={() => addProduct(p)}>
                    <Plus className="h-3 w-3 mr-1" /> Adicionar
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {view === 'comanda' && (
        <div className="flex-1 overflow-auto p-3 pb-32 space-y-3">
          {!locked && (
            <Card className="p-3 space-y-1">
              <div className="text-xs text-muted-foreground">Seu nome</div>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Ex: João" />
            </Card>
          )}
          {items.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              Comanda vazia.
              {!locked && <div className="mt-2"><Button variant="outline" size="sm" onClick={() => setView('menu')}><ArrowLeft className="h-4 w-4 mr-1" /> Ver cardápio</Button></div>}
            </div>
          ) : items.map(i => (
            <Card key={i.id} className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{i.product_name}</div>
                <div className="text-xs text-muted-foreground">R$ {i.product_price.toFixed(2)} • Subtotal R$ {(i.product_price * i.quantity).toFixed(2)}</div>
              </div>
              {!locked ? (
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(i, -1)}><Minus className="h-3 w-3" /></Button>
                  <span className="w-6 text-center font-bold">{i.quantity}</span>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(i, 1)}><Plus className="h-3 w-3" /></Button>
                </div>
              ) : <Badge variant="secondary">x{i.quantity}</Badge>}
            </Card>
          ))}
          {items.length > 0 && (
            <Card className="p-3 bg-primary/5 border-primary/20">
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span><span className="text-primary">R$ {total.toFixed(2)}</span>
              </div>
            </Card>
          )}
        </div>
      )}

      {view === 'ajuda' && (
        <div className="flex-1 overflow-auto p-3 pb-32 space-y-3">
          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Precisa de algo?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {session?.assigned_waiter_name
                ? <>Seu garçom é <strong className="text-foreground">{session.assigned_waiter_name}</strong>. Toque em uma opção ou escreva o que precisa.</>
                : 'Toque em uma opção ou escreva o que precisa.'}
            </p>
          </Card>

          {isSent && (
            <Button className="w-full" variant="default" onClick={() => callWaiter('Cliente quer ALTERAR a comanda já enviada')}>
              <BellRing className="h-4 w-4 mr-1" /> Pedir alteração da comanda
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2">
            {QUICK_REQUESTS.map(q => (
              <Button key={q} variant="outline" className="h-auto py-3 text-sm" onClick={() => callWaiter(q)}>
                {q}
              </Button>
            ))}
          </div>

          <Card className="p-3 space-y-2">
            <div className="text-sm font-medium">Outro pedido</div>
            <Textarea value={requestMsg} onChange={e => setRequestMsg(e.target.value)} placeholder="Ex: trazer um copo a mais..." rows={3} />
            <Button className="w-full" onClick={() => callWaiter(requestMsg)} disabled={!requestMsg.trim()}>
              <BellRing className="h-4 w-4 mr-1" /> Chamar garçom
            </Button>
          </Card>

          {openRequests.length > 0 && (
            <Card className="p-3 space-y-2 border-primary/30">
              <div className="text-sm font-medium text-primary">Aguardando atendimento</div>
              {openRequests.map(r => (
                <div key={r.id} className="text-sm flex items-start gap-2 p-2 rounded bg-primary/5">
                  <BellRing className="h-4 w-4 mt-0.5 text-primary animate-pulse" />
                  <div className="flex-1">{r.message}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {view === 'menu' && !locked && items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur border-t p-3 space-y-2 shadow-lg">
          <div className="flex justify-between font-bold">
            <span>Total</span><span className="text-primary">R$ {total.toFixed(2)}</span>
          </div>
          <Button className="w-full" size="lg" onClick={() => setView('comanda')}>Ver comanda ({itemCount})</Button>
        </div>
      )}

      {view === 'comanda' && !locked && items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur border-t p-3 space-y-2 shadow-lg">
          <Button className="w-full" size="lg" disabled={sending} onClick={finalizeOrder}>
            {sending ? 'Enviando...' : `Enviar comanda — R$ ${total.toFixed(2)}`}
          </Button>
        </div>
      )}
    </div>
  );
}
