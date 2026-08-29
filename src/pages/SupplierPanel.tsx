import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSupplierByToken } from '@/hooks/useSuppliers';
import { Package, Clock, ChefHat, Truck, CheckCircle, MapPin, PackageX, PackageCheck, Bell, MessageCircle, Star, Send, Settings, User, Printer, Sun, Moon, Upload, Download, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { printOrder } from '@/lib/order-print';
import { isPrinterPaired } from '@/lib/printer-bluetooth';
import { isSimulationMode } from '@/lib/printer-simulator';
import SupplierChatPanel from '@/components/tenant/SupplierChatPanel';
import { useSupplierChats } from '@/hooks/useSupplierChat';
import { playShortBeep, unlockAudio } from '@/lib/order-alert-sound';
import SupplierDeliveriesPanel from '@/components/tenant/SupplierDeliveriesPanel';
import SupplierLalamoveConfig from '@/components/tenant/SupplierLalamoveConfig';
import SupplierShippingConfig from '@/components/tenant/SupplierShippingConfig';
import SupplierDriversPanel from '@/components/tenant/SupplierDriversPanel';
import HelpButton from '@/components/tenant/HelpButton';
import SofiaChat from '@/components/SofiaChat';
import { logOrderEvent } from '@/lib/order-events';
import { registerSupplierPushSubscription } from '@/lib/push-notifications';
import { useSupplierReviews } from '@/hooks/useReviews';
import ReviewsList from '@/components/tenant/ReviewsList';
import { unifiedInvoke } from "@/lib/unifiedInvoke";

type OrderWithItems = {
  id: string; status: string; total: number; delivery_type: string; payment_method: string;
  created_at: string; customer_name: string; customer_phone: string; customer_address: string;
  delivery_status_note: string;
  change_for?: number;
  driver_id?: string | null;
  lalamove_order_id?: string | null;
  order_items: { id: string; product_name: string; product_price: number; quantity: number }[];
};

type Product = {
  id: string; name: string; price: number; original_price?: number | null; in_stock: boolean; category: string; supplier_id: string | null;
  stock_quantity: number | null;
};

const statusConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  received: { label: 'Recebido', icon: <Clock className="h-4 w-4" />, color: 'bg-blue-500/20 text-blue-400' },
  preparing: { label: 'Em Preparo', icon: <ChefHat className="h-4 w-4" />, color: 'bg-yellow-500/20 text-yellow-400' },
  'out-for-delivery': { label: 'Saiu p/ Entrega', icon: <Truck className="h-4 w-4" />, color: 'bg-orange-500/20 text-orange-400' },
  'ready-for-pickup': { label: 'Pronto p/ Retirada', icon: <Package className="h-4 w-4" />, color: 'bg-cyan-500/20 text-cyan-400' },
  delivered: { label: 'Entregue', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-green-500/20 text-green-400' },
};

const getNextStatus = (current: string, deliveryType: string): string | null => {
  const isPickup = deliveryType === 'pickup';
  const flow: Record<string, string | null> = isPickup
    ? { received: 'preparing', preparing: 'ready-for-pickup', 'ready-for-pickup': 'delivered', delivered: null }
    : { received: 'preparing', preparing: 'out-for-delivery', 'out-for-delivery': 'delivered', delivered: null };
  return flow[current] ?? null;
};

// Painel fornecedor completo: importação/exportação, estoque, chats e avaliações.
const SupplierPanel = () => {
  const { token } = useParams<{ token: string }>();
  const { data: supplier, isLoading } = useSupplierByToken(token);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<'orders' | 'deliveries' | 'stock' | 'import-export' | 'chats' | 'reviews' | 'lalamove' | 'shipping' | 'drivers'>('orders');
  const [group, setGroup] = useState<'operacao' | 'catalogo' | 'config'>('operacao');
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('supplier-theme');
    if (saved) return saved === 'dark';
    return document.documentElement.classList.contains('dark');
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('supplier-theme', isDark ? 'dark' : 'light');
  }, [isDark]);
  const [activeDrivers, setActiveDrivers] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [lalamoveAvailable, setLalamoveAvailable] = useState(false);
  const [choosingDispatch, setChoosingDispatch] = useState<string | null>(null);
  const [selectingDriver, setSelectingDriver] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
  const [importingPrices, setImportingPrices] = useState(false);
  const [importResult, setImportResult] = useState<{ updated: string[]; notFound: string[]; invalid: string[] } | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [togglingActive, setTogglingActive] = useState(false);
  const prevCountRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const advancingRef = useRef<Set<string>>(new Set());

  // ===== Chat: monitor global de mensagens novas (notifica em qualquer aba) =====
  const { chats: allChats } = useSupplierChats(token || '');
  const chatPrevRef = useRef<Record<string, string>>({});
  const chatInitRef = useRef(false);
  const LAST_SEEN_KEY = 'supplier_chat_last_seen';
  const getLastSeen = (): Record<string, string> => {
    try { return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || '{}'); } catch { return {}; }
  };
  const [chatUnread, setChatUnread] = useState(0);
  const recomputeUnread = useCallback(() => {
    const seen = getLastSeen();
    const n = allChats.reduce((acc, c) => {
      const s = seen[c.id];
      return (!s || new Date(c.updated_at) > new Date(s)) ? acc + 1 : acc;
    }, 0);
    setChatUnread(n);
  }, [allChats]);

  useEffect(() => {
    if (!allChats.length) { setChatUnread(0); return; }
    recomputeUnread();
    const map: Record<string, string> = {};
    let hasNew = false;
    allChats.forEach(c => {
      map[c.id] = c.updated_at;
      const prev = chatPrevRef.current[c.id];
      if (chatInitRef.current && (!prev || c.updated_at > prev)) hasNew = true;
    });
    if (hasNew && tab !== 'chats') {
      try { unlockAudio(); playShortBeep(); } catch {}
      toast.info('💬 Nova mensagem de cliente', { description: 'Veja na aba Chats' });
    }
    chatPrevRef.current = map;
    chatInitRef.current = true;
  }, [allChats, tab, recomputeUnread]);

  // Recalcula contador quando o usuário entra/sai da aba chats (marca como visto lá dentro)
  useEffect(() => {
    const i = setInterval(recomputeUnread, 3000);
    return () => clearInterval(i);
  }, [recomputeUnread]);

  // Carrega dados do tenant pra impressão + estado active do fornecedor
  useEffect(() => {
    if (!supplier) return;
    setIsActive(supplier.active !== false);
    supabase.from('tenants_public').select('*').eq('id', supplier.tenant_id).single()
      .then(({ data }) => setTenant(data));
  }, [supplier]);

  const toggleActive = async () => {
    if (!supplier || togglingActive) return;
    const next = !isActive;
    if (!next && !confirm('Pausar atendimento? Você não receberá novos pedidos até reativar.')) return;
    setTogglingActive(true);
    setIsActive(next); // otimista
    const { error } = await supabase.from('suppliers').update({ active: next }).eq('id', supplier.id);
    setTogglingActive(false);
    if (error) {
      setIsActive(!next);
      toast.error('Erro ao atualizar status');
    } else {
      toast.success(next ? '✅ Atendimento ativo!' : '⏸️ Atendimento pausado');
    }
  };

  const handleManualPrint = async (order: OrderWithItems) => {
    if (!tenant) {
      toast.error('Aguarde os dados da loja carregarem');
      return;
    }
    const sim = isSimulationMode();
    if (!sim && !isPrinterPaired()) {
      toast.error('Pareie uma impressora ou ative o Modo Simulação no painel da loja');
      return;
    }
    setPrintingId(order.id);
    const toastId = toast.loading(sim ? 'Gerando simulação...' : 'Enviando pra impressora...');
    try {
      await printOrder(order as any, tenant);
      toast.success(sim ? '✅ Janela de simulação aberta' : '✅ Cupom enviado', { id: toastId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`❌ Falha: ${msg}`, { id: toastId });
    } finally {
      setPrintingId(null);
    }
  };

  const fetchProducts = useCallback(async () => {
    if (!supplier) return;
    // Only fetch products assigned to this supplier
    const { data } = await supabase.from('products').select('id, name, price, original_price, in_stock, category, supplier_id')
      .eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id);
    setProducts((data as Product[]) || []);
  }, [supplier]);

  const fetchOrdersRef = useRef<() => Promise<void>>(async () => {});

  const fetchOrders = useCallback(async () => {
    if (!supplier) return;
    try {
      // Always fetch supplier's products fresh to avoid stale state
      const { data: freshProducts } = await supabase.from('products').select('id, name, price, original_price, in_stock, category, supplier_id, stock_quantity')
        .eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id);
      const myProducts = (freshProducts as Product[]) || [];
      setProducts(prev => (prev.length === 0 && myProducts.length > 0 ? myProducts : prev));
      const myProductNames = new Set(myProducts.map(p => p.name));

      const { data, error: ordersErr } = await supabase
        .from('orders').select('*, order_items(*)')
        .eq('tenant_id', supplier.tenant_id)
        .in('status', ['received', 'preparing', 'out-for-delivery'])
        .order('created_at', { ascending: false });

      if (ordersErr) {
        console.error('[SupplierPanel] orders query error:', ordersErr);
        return;
      }

      // Filter: orders directly assigned to this supplier OR containing my products
      const allOrders = (data as any[]) || [];
      const relevantOrders = allOrders.filter(o =>
        o.supplier_id === supplier.id ||
        (o.order_items || []).some((item: any) => myProductNames.has(item.product_name))
      ) as OrderWithItems[];

      console.log('[SupplierPanel] fetched', allOrders.length, 'total orders,', relevantOrders.length, 'relevant for supplier', supplier.id);

      // Check tenant automation flag (non-blocking — failure should not hide orders)
      let autoEnabled = true;
      let reviewMode = false;
      try {
        const { data: tenantData } = await supabase.from('tenants_public')
          .select('auto_dropshipping_enabled, dropshipping_review_mode')
          .eq('id', supplier.tenant_id).single();
        autoEnabled = (tenantData as any)?.auto_dropshipping_enabled ?? true;
        reviewMode = (tenantData as any)?.dropshipping_review_mode ?? false;
      } catch (e) { console.warn('tenant flag fetch failed', e); }

      // ALWAYS render orders FIRST so UI never depends on auto-advance side-effects
      if (relevantOrders.length > prevCountRef.current && prevCountRef.current > 0) {
        try { audioRef.current?.play(); } catch {}
        toast.success('🔔 Novo pedido recebido!');
        unifiedInvoke("notify-unified", "push", {
            supplierId: supplier.id,
            title: '🔔 Novo pedido!',
            body: `Você recebeu um novo pedido na ${supplier.name}.`,
          }).catch(e => console.error('Push to supplier failed:', e));
      }
      prevCountRef.current = relevantOrders.length;
      setOrders(relevantOrders);

      // Auto-advance "received" → "preparing" in background (does not block render)
      if (autoEnabled && !reviewMode) {
        for (const order of relevantOrders) {
          if (order.status === 'received' && !advancingRef.current.has(order.id)) {
            advancingRef.current.add(order.id);
            supabase
              .from('orders').update({ status: 'preparing' })
              .eq('id', order.id).eq('status', 'received')
              .then(({ error: updErr }) => {
                if (!updErr) {
                  logOrderEvent({
                    order_id: order.id,
                    tenant_id: supplier.tenant_id,
                    event_type: 'auto_advance',
                    from_status: 'received',
                    to_status: 'preparing',
                    actor: 'supplier',
                    actor_id: supplier.id,
                    description: `Fornecedor "${supplier.name}" abriu o pedido — avanço automático`,
                  }).catch(() => {});
                }
              });
          }
        }
      }
    } catch (err) {
      console.error('[SupplierPanel] fetchOrders error (will retry):', err);
    }
  }, [supplier]);

  // Keep ref pointing at latest fetchOrders so subscriptions/intervals never go stale
  useEffect(() => { fetchOrdersRef.current = fetchOrders; }, [fetchOrders]);

  useEffect(() => {
    if (!supplier) return;

    fetchProducts().then(() => fetchOrdersRef.current());

    const interval = setInterval(() => {
      fetchOrdersRef.current();
    }, 5000);

    let channel = supabase
      .channel(`supplier-orders-${supplier.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${supplier.tenant_id}` },
        () => fetchOrdersRef.current()
      )
      .subscribe((status) => {
        console.log('[SupplierPanel] realtime status:', status);
      });

    // Reconectar quando aba volta ao foco (celular: tela apaga → desbloqueia)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        console.log('[SupplierPanel] aba ativa — refetch + reconnect');
        fetchOrdersRef.current();
        supabase.removeChannel(channel);
        channel = supabase
          .channel(`supplier-orders-${supplier.id}-${Date.now()}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${supplier.tenant_id}` },
            () => fetchOrdersRef.current()
          )
          .subscribe();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('online', handleVisibility);

    registerSupplierPushSubscription(supplier.id).then(ok => {
      if (ok) toast.success('🔔 Notificações de novos pedidos ativadas!');
    });

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('online', handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [supplier, fetchProducts]);

  // Carrega motoboys ativos + disponibilidade Lalamove (própria do fornecedor OU da loja aprovada)
  useEffect(() => {
    if (!supplier) return;
    let cancelled = false;
    const load = async () => {
      if (!token) return;
      const [{ data: drvs }, { data: lalamoveStatus }] = await Promise.all([
        (supabase as any).rpc('list_active_drivers_for_supplier', { _supplier_token: token }),
        (supabase as any).rpc('get_supplier_lalamove_status', { _supplier_token: token }),
      ]);
      if (cancelled) return;
      setActiveDrivers((drvs as Array<{ id: string; name: string; phone: string }>) || []);
      setLalamoveAvailable(!!(lalamoveStatus as any)?.available);
    };
    load();
    const i = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(i); };
  }, [supplier]);

  const dispatchLalamove = async (orderId: string) => {
    if (!supplier) return;
    setChoosingDispatch(null);
    setAdvancingId(orderId);
    const toastId = toast.loading('Chamando Lalamove...');
    try {
      const { data, error } = await unifiedInvoke("delivery-unified", "lalamove-request", { orderId, supplierId: supplier.id, calledBy: 'supplier' });
      if (error || (data as { error?: string })?.error) {
        throw new Error((data as { error?: string })?.error || error?.message || 'Erro Lalamove');
      }
      const d = data as { price?: number; payer?: string };
      await supabase.from('orders').update({ status: 'out-for-delivery' }).eq('id', orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'out-for-delivery' } : o));
      const payer = d.payer === 'supplier' ? 'fornecedor' : 'loja';
      toast.success(`✅ Lalamove acionada! R$${d.price || '?'} (paga: ${payer})`, { id: toastId, duration: 6000 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha Lalamove: ${msg}`, { id: toastId, duration: 8000 });
    } finally {
      setAdvancingId(null);
    }
  };

  const assignDriverAndDispatch = async (orderId: string, driverId: string) => {
    setSelectingDriver(null);
    const wasOutForDelivery = orders.find(o => o.id === orderId)?.status === 'out-for-delivery';
    // Atualização otimista
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'out-for-delivery', driver_id: driverId, lalamove_order_id: null } : o));
    toast.success(wasOutForDelivery ? 'Motoboy trocado!' : 'Pedido despachado com motoboy!');
    await supabase.from('orders').update({
      status: 'out-for-delivery',
      driver_id: driverId,
      lalamove_order_id: null,
      lalamove_status: null,
      lalamove_share_link: null,
      lalamove_driver_name: null,
      lalamove_driver_phone: null,
      lalamove_driver_plate: null,
    } as any).eq('id', orderId);
    const order = orders.find(o => o.id === orderId);
    try {
      await unifiedInvoke("notify-unified", "push", {
        driverId,
        title: "🏍️ Nova entrega!",
        body: `Pedido #${orderId.slice(0, 6)} - ${order?.customer_name || "Cliente"} - ${order?.customer_address || ""}`,
      });
    } catch (e) { console.error('Push falhou:', e); }
  };

  const switchToLalamove = async (orderId: string) => {
    if (!supplier) return;
    if (!confirm('Trocar entrega para Lalamove? Isso vai liberar o motoboy atual.')) return;
    await supabase.from('orders').update({ driver_id: null } as any).eq('id', orderId);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, driver_id: null } : o));
    await dispatchLalamove(orderId);
  };

  const switchToDriver = (orderId: string) => {
    if (activeDrivers.length === 0) {
      toast.error('Nenhum motoboy ativo disponível.');
      return;
    }
    if (activeDrivers.length === 1) {
      assignDriverAndDispatch(orderId, activeDrivers[0].id);
      return;
    }
    setSelectingDriver(orderId);
  };

  const advanceStatus = async (id: string, current: string, deliveryType: string) => {
    const next = getNextStatus(current, deliveryType);
    if (!next || !supplier) return;

    // Antes de despachar para entrega, perguntar Lalamove vs motoboy próprio
    if (next === 'out-for-delivery') {
      // Tem as duas opções → modal de escolha
      if (activeDrivers.length > 0 && lalamoveAvailable) {
        setChoosingDispatch(id);
        return;
      }
      // Só motoboy próprio
      if (activeDrivers.length > 0) {
        if (activeDrivers.length === 1) {
          await assignDriverAndDispatch(id, activeDrivers[0].id);
          return;
        }
        setSelectingDriver(id);
        return;
      }
      // Só Lalamove
      if (lalamoveAvailable) {
        if (!confirm('Sem motoboy próprio cadastrado. Chamar Lalamove agora?')) return;
        await dispatchLalamove(id);
        return;
      }
      // Nenhuma das duas: avança o status mesmo assim (loja sem entrega configurada)
    }

    // Atualização otimista — UI muda na hora, banco em background
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: next } : o));
    toast.success(`Status → ${statusConfig[next]?.label}`);

    try {
      await supabase.from('orders').update({ status: next }).eq('id', id);
      await logOrderEvent({
        order_id: id,
        tenant_id: supplier.tenant_id,
        event_type: 'status_change',
        from_status: current,
        to_status: next,
        actor: 'supplier',
        actor_id: supplier.id,
        description: 'Fornecedor avançou status manualmente',
      });
    } catch (e) {
      // Reverte se falhar
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: current } : o));
      toast.error('Erro ao atualizar status');
      console.error(e);
    }
  };

  const toggleStock = async (p: Product) => {
    await supabase.from('products').update({ in_stock: !p.in_stock }).eq('id', p.id);
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, in_stock: !x.in_stock } : x));
    toast.success(p.in_stock ? 'Marcado como sem estoque' : 'Marcado como em estoque');
  };

  const updateStockQty = async (p: Product, delta: number) => {
    const current = p.stock_quantity ?? 0;
    const newQty = Math.max(0, current + delta);
    await supabase.from('products').update({ stock_quantity: newQty, in_stock: newQty > 0 } as any).eq('id', p.id);
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, stock_quantity: newQty, in_stock: newQty > 0 } : x));
    toast.success(`Estoque atualizado: ${newQty}`);
  };

  const normalizeProductName = (value: string) => value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const parsePrice = (value: string) => {
    const normalized = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };

  const cleanImportedName = (value: string) => value
    .replace(/\*/g, '').replace(/[_~`]/g, '').replace(/[🇧🇷🇨🇳☀️😍🤩🟢⚠️‼️]/gu, '')
    .replace(/\(\s*R?\$?.*$/i, '').replace(/\s+-\s*$/, '').replace(/[：:]+$/, '').trim();

  const sectionBrand = (line: string) => {
    const upper = line.toLocaleUpperCase('pt-BR');
    if (!line.includes('🟢') && !/LINHA\s+(REDMI|NOTE|POCO|MI)/i.test(line)) return '';
    if (upper.includes('SAMSUNG')) return 'Samsung';
    if (upper.includes('MOTOROLA')) return 'Motorola';
    if (upper.includes('REALME')) return 'Realme';
    if (upper.includes('INFINIX')) return 'Infinix';
    if (upper.includes('OPPO')) return 'Oppo';
    if (upper.includes('HONOR')) return 'Honor';
    if (upper.includes('REDMI')) return 'Redmi';
    if (upper.includes('POCO')) return 'Poco';
    if (/LINHA\s+MI/i.test(line)) return 'Mi';
    if (/LINHA\s+NOTE/i.test(line)) return 'Note';
    return '';
  };

  const parseImportedEntries = (text: string) => {
    const entries: { name: string; cost: number | null; resale: number | null; aliases: string[] }[] = [];
    let brand = '';
    let pending = '';
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      const detectedBrand = sectionBrand(line);
      if (detectedBrand) { brand = detectedBrand; pending = ''; continue; }
      if (!line) continue;
      const candidate = pending ? `${pending} ${line}` : line;
      const priceMatch = candidate.match(/R?\$\s*([\d.]+(?:,\d{1,2})?)/i);
      if (!priceMatch) {
        // Produtos WhatsApp normalmente começam com * e recebem o preço na linha seguinte.
        if (/^\s*\*/.test(line) && !/^(?:\*?\d{1,2}\/\d{1,2}\/\d{2,4}|\*?confira|\*?obs)/i.test(line)) pending = candidate;
        continue;
      }
      pending = '';
      const costMarker = candidate.search(/\s+-\s*CUSTO\s*:/i);
      const resaleMarker = candidate.search(/\s+-\s*REVENDA\s*:/i);
      const explicit = costMarker >= 0 || resaleMarker >= 0;
      const costMatch = candidate.match(/\s+-\s*CUSTO\s*:\s*R?\$?\s*([\d.]+(?:,\d{1,2})?)/i);
      const resaleMatch = candidate.match(/\s+-\s*REVENDA\s*:\s*R?\$?\s*([\d.]+(?:,\d{1,2})?)/i);
      const cost = costMatch ? parsePrice(costMatch[1]) : (explicit ? null : parsePrice(priceMatch[1]));
      const resale = resaleMatch ? parsePrice(resaleMatch[1]) : null;
      const marker = [costMarker, resaleMarker].filter(i => i >= 0).sort((a, b) => a - b)[0];
      const name = cleanImportedName(candidate.slice(0, marker >= 0 ? marker : candidate.search(/R?\$/i)));
      if (!name || (cost == null && resale == null)) continue;
      const aliases = [name];
      if (brand && !new RegExp(`^${brand}\\b`, 'i').test(name)) aliases.push(`${brand} ${name}`);
      entries.push({ name, cost, resale, aliases });
    }
    return entries;
  };

  const importPrices = async () => {
    if (!supplier || importingPrices) return;
    const entries = parseImportedEntries(priceText);
    if (entries.length === 0) {
      toast.error('Nenhuma linha válida encontrada. Use: produto - CUSTO: R$ 990,00 - REVENDA: R$ 1.199,00');
      return;
    }
    setImportingPrices(true);
    const byName = new Map(products.map(p => [normalizeProductName(p.name), p]));
    const updated: string[] = [];
    const notFound: string[] = [];
    const invalid: string[] = [];
    try {
      for (const entry of entries) {
        const product = entry.aliases.map(alias => byName.get(normalizeProductName(alias).replace(/\bsansung\b/g, 'samsung'))).find(Boolean);
        if (!product) { notFound.push(entry.name); continue; }
        const patch: Record<string, number> = {};
        if (entry.cost != null) patch.original_price = entry.cost;
        if (entry.resale != null) patch.price = entry.resale;
        if (Object.keys(patch).length === 0) { invalid.push(entry.name); continue; }
        const { error } = await supabase.from('products').update(patch).eq('id', product.id).eq('supplier_id', supplier.id);
        if (error) { invalid.push(`${entry.name} (${error.message})`); continue; }
        updated.push(entry.name);
        Object.assign(product, patch);
      }
      setProducts([...products]);
      setImportResult({ updated, notFound, invalid });
      if (updated.length) toast.success(`${updated.length} produto(s) atualizado(s)`);
      if (!updated.length) toast.error('Nenhum produto foi atualizado');
    } finally {
      setImportingPrices(false);
    }
  };

  const exportPrices = () => {
    const lines = products.map(p => `${p.name} - CUSTO: R$ ${Number(p.original_price || 0).toFixed(2).replace('.', ',')} - ${p.category || 'PRODUTO'} - REVENDA: R$ ${Number(p.price || 0).toFixed(2).replace('.', ',')}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `precos-${supplier?.name?.replace(/\s+/g, '-').toLowerCase() || 'fornecedor'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!supplier) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Fornecedor não encontrado.</p></div>;

  return (
    <div className="min-h-screen bg-background">
      <audio ref={audioRef} src="https://actions.google.com/sounds/v1/alarms/beep_short.ogg" preload="auto" />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Package className="h-5 w-5 text-primary shrink-0" />
            <span className="font-heading text-lg text-foreground truncate">Painel Fornecedor</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={toggleActive}
              disabled={togglingActive}
              title={isActive ? 'Pausar atendimento' : 'Ativar atendimento'}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
                isActive
                  ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                  : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              {isActive ? 'Ativo' : 'Pausado'}
            </button>
            <button
              onClick={() => setIsDark(d => !d)}
              title={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-[180px]">{supplier.name}</span>
          </div>
        </div>
        {!isActive && (
          <div className="bg-red-500/10 border-t border-red-500/20 px-4 py-1.5 text-center">
            <span className="text-xs text-red-300">⏸️ Atendimento pausado — você não está recebendo novos pedidos</span>
          </div>
        )}
        {(tenant as any)?.dropshipping_submode === 'whatsapp' && (
          <div className="bg-primary/10 border-t border-primary/20 px-4 py-1.5 text-center">
            <span className="text-xs text-primary">💬 Esta loja opera no modo WhatsApp Consultora — pedidos podem chegar via mensagem</span>
          </div>
        )}
      </header>

      {(() => {
        const TAB_GROUP: Record<typeof tab, 'operacao' | 'catalogo' | 'config'> = {
          orders: 'operacao', deliveries: 'operacao', drivers: 'operacao',
          stock: 'catalogo', 'import-export': 'catalogo', chats: 'catalogo', reviews: 'catalogo',
          shipping: 'config', lalamove: 'config',
        };
        // Mantém grupo sincronizado se a tab atual pertence a outro grupo
        const currentGroup = TAB_GROUP[tab] ?? group;
        if (currentGroup !== group) setGroup(currentGroup);
        return null;
      })()}

      <div className="container mx-auto px-4 py-4">
        {/* Nível 1: grupos temáticos */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {([
            { id: 'operacao', label: 'Operação', icon: <Bell className="h-4 w-4" /> },
            { id: 'catalogo', label: 'Catálogo', icon: <PackageCheck className="h-4 w-4" /> },
            { id: 'config', label: 'Configurações', icon: <Settings className="h-4 w-4" /> },
          ] as const).map(g => (
            <button
              key={g.id}
              onClick={() => {
                setGroup(g.id);
                const firstTab: Record<typeof g.id, typeof tab> = {
                  operacao: 'orders', catalogo: 'stock', config: 'shipping',
                };
                setTab(firstTab[g.id]);
              }}
              className={`relative flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
                group === g.id ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              {g.icon}
              <span>{g.label}</span>
            </button>
          ))}
        </div>

        {/* Nível 2: sub-tabs do grupo selecionado */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(() => {
            const ALL_TABS = [
              { id: 'orders' as const, label: 'Pedidos', icon: <Bell className="h-4 w-4" />, group: 'operacao' as const },
              { id: 'deliveries' as const, label: 'Entregas', icon: <Send className="h-4 w-4" />, group: 'operacao' as const },
              { id: 'drivers' as const, label: 'Motoboys', icon: <User className="h-4 w-4" />, group: 'operacao' as const },
              { id: 'stock' as const, label: 'Estoque', icon: <PackageCheck className="h-4 w-4" />, group: 'catalogo' as const },
              { id: 'import-export' as const, label: 'Importar / Exportar', icon: <FileText className="h-4 w-4" />, group: 'catalogo' as const },
              { id: 'chats' as const, label: 'Chats', icon: <MessageCircle className="h-4 w-4" />, group: 'catalogo' as const },
              { id: 'reviews' as const, label: 'Avaliações', icon: <Star className="h-4 w-4" />, group: 'catalogo' as const },
              { id: 'shipping' as const, label: 'Frete', icon: <Truck className="h-4 w-4" />, group: 'config' as const },
              { id: 'lalamove' as const, label: 'Lalamove', icon: <Settings className="h-4 w-4" />, group: 'config' as const },
            ];
            return ALL_TABS.filter(t => t.group === group).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.id === 'chats' && chatUnread > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold animate-pulse">
                    {chatUnread}
                  </span>
                )}
              </button>
            ));
          })()}
          <div className="ml-auto">
            {(() => {
              const HELP_TOPIC: Record<typeof tab, string> = {
                orders: 'supplierOrders',
                deliveries: 'supplierDeliveries',
                drivers: 'supplierDrivers',
                stock: 'supplierStock',
                'import-export': 'supplierImportExport',
                chats: 'supplierChats',
                reviews: 'supplierReviews',
                shipping: 'supplierShipping',
                lalamove: 'supplierLalamove',
              };
              return <HelpButton topic={HELP_TOPIC[tab]} label="Como usar" />;
            })()}
          </div>
        </div>

        {tab === 'orders' && (
          <div className="space-y-4">
            {orders.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum pedido ativo.</p>}
            {orders.map(order => {
              const cfg = statusConfig[order.status] || statusConfig.received;
              return (
                <div key={order.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Package className="h-4 w-4 text-primary" />
                      <span className="font-medium text-foreground text-sm">#{order.id.slice(0, 6)}</span>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleManualPrint(order)}
                        disabled={printingId === order.id}
                        title="Imprimir cupom"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-primary transition-colors disabled:opacity-50"
                      >
                        <Printer className={`h-4 w-4 ${printingId === order.id ? 'animate-pulse' : ''}`} />
                      </button>
                      <span className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString('pt-BR')}</span>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p><strong className="text-foreground">{order.customer_name}</strong> · {order.customer_phone}</p>
                    {order.delivery_type === 'delivery' && <p className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {order.customer_address}</p>}
                    <p className="flex items-center gap-2 flex-wrap">
                      <span>💳 <strong className="text-foreground">{order.payment_method}</strong></span>
                      {/mercadopago/i.test(order.payment_method) ? (
                        <span className="rounded-full bg-green-500/20 text-green-400 px-2 py-0.5 text-[11px] font-bold">✅ PAGO ONLINE</span>
                      ) : (
                        <span className="rounded-full bg-yellow-500/20 text-yellow-400 px-2 py-0.5 text-[11px] font-bold">
                          💵 PAGAR {order.delivery_type === 'delivery' ? 'NA ENTREGA' : 'NO BALCÃO'}
                        </span>
                      )}
                    </p>
                    {(order as any).change_for > 0 && /dinheiro|cash/i.test(order.payment_method || '') && (
                      <p className="text-xs text-yellow-400 font-medium">💵 Troco p/ R${Number((order as any).change_for).toFixed(2)} — levar R${(Number((order as any).change_for) - order.total).toFixed(2)}</p>
                    )}
                  </div>
                  <div className="text-sm space-y-1">
                    {order.order_items.map(i => (
                      <div key={i.id} className="flex justify-between text-muted-foreground">
                        <span>{i.quantity}x {i.product_name}</span>
                        <span>R${(i.product_price * i.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-foreground border-t border-border pt-1">
                      <span>Total</span><span className="text-primary">R${order.total.toFixed(2)}</span>
                    </div>
                  </div>
                  {choosingDispatch === order.id && (
                    <div className="rounded-lg border border-primary/30 bg-secondary p-3 space-y-2">
                      <p className="text-sm font-medium text-foreground">Como despachar este pedido?</p>
                      <button onClick={() => { setChoosingDispatch(null); if (activeDrivers.length === 1) { assignDriverAndDispatch(order.id, activeDrivers[0].id); } else { setSelectingDriver(order.id); } }}
                        className="w-full flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-sm text-foreground hover:border-primary transition-colors">
                        <User className="h-4 w-4 text-primary" />
                        <span>Motoboy próprio</span>
                        <span className="text-xs text-muted-foreground ml-auto">{activeDrivers.length} disponível(is)</span>
                      </button>
                      <button onClick={() => dispatchLalamove(order.id)}
                        disabled={advancingId === order.id}
                        className="w-full flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-sm text-foreground hover:border-primary transition-colors disabled:opacity-50">
                        <Truck className="h-4 w-4 text-orange-400" />
                        <span>Lalamove (automático)</span>
                        <span className="text-xs text-muted-foreground ml-auto">cota e dispara</span>
                      </button>
                      <button onClick={() => setChoosingDispatch(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
                    </div>
                  )}

                  {selectingDriver === order.id && (
                    <div className="rounded-lg border border-primary/30 bg-secondary p-3 space-y-2">
                      <p className="text-sm font-medium text-foreground">Escolha o motoboy:</p>
                      {activeDrivers.map(d => (
                        <button key={d.id} onClick={() => assignDriverAndDispatch(order.id, d.id)}
                          className="w-full flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-sm text-foreground hover:border-primary transition-colors">
                          <Truck className="h-4 w-4 text-primary" />
                          <span>{d.name}</span>
                          <span className="text-xs text-muted-foreground">· {d.phone}</span>
                        </button>
                      ))}
                      <button onClick={() => setSelectingDriver(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
                    </div>
                  )}

                  {/* Botões de troca quando já está em rota de entrega */}
                  {order.status === 'out-for-delivery' && choosingDispatch !== order.id && selectingDriver !== order.id && (
                    <div className="grid grid-cols-2 gap-2">
                      {activeDrivers.length > 0 && (
                        <button onClick={() => switchToDriver(order.id)}
                          disabled={advancingId === order.id}
                          className="flex items-center justify-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/5 text-orange-400 py-2 text-xs font-medium hover:bg-orange-500/10 disabled:opacity-50">
                          <User className="h-3 w-3" /> Trocar motoboy
                        </button>
                      )}
                      {lalamoveAvailable && (
                        <button onClick={() => switchToLalamove(order.id)}
                          disabled={advancingId === order.id}
                          className="flex items-center justify-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/5 text-orange-400 py-2 text-xs font-medium hover:bg-orange-500/10 disabled:opacity-50">
                          <Truck className="h-3 w-3" /> Trocar p/ Lalamove
                        </button>
                      )}
                    </div>
                  )}

                  {getNextStatus(order.status, order.delivery_type) && choosingDispatch !== order.id && selectingDriver !== order.id && (
                    <button onClick={() => advanceStatus(order.id, order.status, order.delivery_type)}
                      disabled={advancingId === order.id}
                      className="w-full rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                      {advancingId === order.id ? 'Avançando...' : `Avançar → ${statusConfig[getNextStatus(order.status, order.delivery_type)!]?.label}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'stock' && (
          <div className="space-y-2">
            {products.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum produto associado a você.</p>}
            {products.map(p => (
              <div key={p.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">{p.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{p.category} · R${p.price.toFixed(2)}</span>
                  </div>
                  <button onClick={() => toggleStock(p)} className={`shrink-0 flex items-center gap-1 text-xs rounded-full px-3 py-1 font-medium ${p.in_stock ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {p.in_stock ? <PackageCheck className="h-3 w-3" /> : <PackageX className="h-3 w-3" />}
                    {p.in_stock ? 'Em estoque' : 'Sem estoque'}
                  </button>
                </div>
                {p.stock_quantity != null ? (
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-muted-foreground">Qtd:</span>
                    <button onClick={() => updateStockQty(p, -1)} className="rounded bg-secondary px-2 py-0.5 text-foreground hover:bg-primary/20 text-xs">-1</button>
                    <span className="font-bold text-foreground w-8 text-center">{p.stock_quantity}</span>
                    <button onClick={() => updateStockQty(p, 1)} className="rounded bg-secondary px-2 py-0.5 text-foreground hover:bg-primary/20 text-xs">+1</button>
                    <button onClick={() => updateStockQty(p, -5)} className="rounded bg-secondary px-2 py-0.5 text-muted-foreground hover:bg-primary/20 text-xs">-5</button>
                    <button onClick={() => updateStockQty(p, 5)} className="rounded bg-secondary px-2 py-0.5 text-muted-foreground hover:bg-primary/20 text-xs">+5</button>
                    <button
                      onClick={async () => {
                        const v = prompt(`Definir quantidade exata de "${p.name}":`, String(p.stock_quantity ?? 0));
                        if (v == null) return;
                        const n = parseInt(v, 10);
                        if (Number.isNaN(n) || n < 0) { toast.error('Quantidade inválida'); return; }
                        await supabase.from('products').update({ stock_quantity: n, in_stock: n > 0 } as any).eq('id', p.id);
                        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, stock_quantity: n, in_stock: n > 0 } : x));
                        toast.success(`Estoque definido: ${n}`);
                      }}
                      className="rounded bg-primary/15 text-primary px-2 py-0.5 text-xs hover:bg-primary/25"
                    >
                      Definir
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Desativar controle de quantidade? O produto fica disponível enquanto "em estoque" estiver ligado, sem contagem.')) return;
                        await supabase.from('products').update({ stock_quantity: null } as any).eq('id', p.id);
                        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, stock_quantity: null } : x));
                        toast.success('Controle de quantidade desativado');
                      }}
                      className="rounded bg-secondary px-2 py-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive text-xs"
                    >
                      ✕ Desativar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      const v = prompt(`Quantidade inicial de "${p.name}" em estoque:`, '10');
                      if (v == null) return;
                      const n = parseInt(v, 10);
                      if (Number.isNaN(n) || n < 0) { toast.error('Quantidade inválida'); return; }
                      await supabase.from('products').update({ stock_quantity: n, in_stock: n > 0 } as any).eq('id', p.id);
                      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, stock_quantity: n, in_stock: n > 0 } : x));
                      toast.success(`Controle ativado: ${n} unidades`);
                    }}
                    className="w-full rounded-md border border-dashed border-border bg-secondary/30 text-muted-foreground hover:text-primary hover:border-primary text-xs py-1.5"
                  >
                    + Ativar controle de quantidade
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'import-export' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground"><Upload className="h-5 w-5 text-primary" /> Importar preços</h2>
              <p className="text-xs text-muted-foreground">Cole o texto abaixo ou escolha um arquivo .txt. Só serão atualizados produtos vinculados a este fornecedor, por nome exato.</p>
              <div className="rounded-md bg-secondary/60 p-3 text-xs text-muted-foreground font-mono">samsung a9 8.7 64/4gb - CUSTO: R$ 990,00 - TABLET - REVENDA: R$ 1.199,00</div>
              <textarea value={priceText} onChange={e => { setPriceText(e.target.value); setImportResult(null); }} rows={8} placeholder="Uma linha por produto..." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:border-primary">
                  <FileText className="h-4 w-4" /> Escolher .txt
                  <input type="file" accept=".txt,text/plain" className="hidden" onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setPriceText(await file.text());
                    setImportResult(null);
                    e.currentTarget.value = '';
                  }} />
                </label>
                <button type="button" onClick={importPrices} disabled={importingPrices || !priceText.trim()} className="inline-flex items-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  <Upload className="h-4 w-4" /> {importingPrices ? 'Atualizando...' : 'Atualizar preços'}
                </button>
                <button type="button" onClick={exportPrices} disabled={!products.length} className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:border-primary disabled:opacity-50">
                  <Download className="h-4 w-4" /> Exportar .txt
                </button>
              </div>
            </div>
            {importResult && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-2 text-sm">
                <p className="font-semibold text-foreground">Resultado: {importResult.updated.length} atualizado(s), {importResult.notFound.length} não encontrado(s).</p>
                {importResult.updated.length > 0 && <p className="text-xs text-green-400">Atualizados: {importResult.updated.join(', ')}</p>}
                {importResult.notFound.length > 0 && <p className="text-xs text-yellow-400">Não encontrados: {importResult.notFound.join(', ')}</p>}
                {importResult.invalid.length > 0 && <p className="text-xs text-red-400">Com erro: {importResult.invalid.join(', ')}</p>}
              </div>
            )}
          </div>
        )}

        {tab === 'deliveries' && (
          <SupplierDeliveriesPanel supplierId={supplier.id} tenantId={supplier.tenant_id} supplierName={supplier.name} />
        )}

        {tab === 'drivers' && (
          <SupplierDriversPanel supplierId={supplier.id} tenantId={supplier.tenant_id} supplierName={supplier.name} />
        )}

        {tab === 'chats' && (
          <SupplierChatPanel supplierId={supplier.id} />
        )}

        {tab === 'reviews' && <SupplierReviewsTab supplierId={supplier.id} />}

        {tab === 'lalamove' && <SupplierLalamoveConfig supplierId={supplier.id} />}

        {tab === 'shipping' && <SupplierShippingConfig supplierId={supplier.id} initialAddress={supplier.address || ''} />}
      </div>

      {/* Sofia — papel travado: fornecedor. Backend sabe os pedidos abertos dele. */}
      <SofiaChat
        role="supplier"
        supplierId={supplier.id}
        greeting={`Oi! Sou a **Sofia** ✨ Tô aqui no seu painel de fornecedor da **${supplier.name}**. Pergunta como aceitar pedido, controlar estoque, configurar frete ou acionar Lalamove.`}
      />
    </div>
  );
};

const SupplierReviewsTab = ({ supplierId }: { supplierId: string }) => {
  const { data: reviews = [], isLoading } = useSupplierReviews(supplierId);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <Star className="h-5 w-5 text-yellow-400" /> Avaliações dos Clientes
      </h2>
      <ReviewsList reviews={reviews} loading={isLoading} />
    </div>
  );
};

export default SupplierPanel;
