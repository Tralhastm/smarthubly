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
  subcategory?: string | null; subcategory_ids?: string[] | null;
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
  const [priceUpdateMode, setPriceUpdateMode] = useState<'cost' | 'resale' | 'both'>('cost');
  const [importingPrices, setImportingPrices] = useState(false);
  const [importResult, setImportResult] = useState<{ updated: string[]; notFound: string[]; invalid: string[]; warnings: string[] } | null>(null);
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
    const { data } = await supabase.from('products').select('id, name, price, original_price, in_stock, category, subcategory, subcategory_ids, supplier_id')
      .eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id);
    setProducts((data as Product[]) || []);
  }, [supplier]);

  const fetchOrdersRef = useRef<() => Promise<void>>(async () => {});

  const fetchOrders = useCallback(async () => {
    if (!supplier) return;
    try {
      // Always fetch supplier's products fresh to avoid stale state
      const { data: freshProducts } = await supabase.from('products').select('id, name, price, original_price, in_stock, category, subcategory, subcategory_ids, supplier_id, stock_quantity')
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
  const normalizeSupplierProductName = (value: string) => normalizeProductName(value)
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\bnfce\b/g, 'nfc')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
  const extractColors = (value: string) => {
    const colorPattern = /\b(preto|preta|azul|verde|laranja|roxo|rosa|cinza|branco|branca|dourado|dourada|prata|marrom|vermelho|vermelha|titanium|grafite|gold|black|white|camuflada)\b/giu;
    return [...value.matchAll(colorPattern)].map(match => match[1]).filter((color, index, all) => all.findIndex(c => c.toLocaleLowerCase('pt-BR') === color.toLocaleLowerCase('pt-BR')) === index);
  };
  const inferProductCategory = (value: string) => {
    const name = normalizeSupplierProductName(value);
    const rules: Array<[RegExp, string]> = [
      [/^(?:samsung|galaxy)\b/i, 'Samsung Galaxy'],
      [/^(?:motorola|moto)\b/i, 'Motorola'],
      [/^realme\b/i, 'Xiaomi · Redmi · Poco'],
      [/^redmi\b/i, 'Xiaomi · Redmi · Poco'],
      [/^poco\b/i, 'Xiaomi · Redmi · Poco'],
      [/^(?:xiaomi|mi|go\s+mi)\b/i, 'Xiaomi · Redmi · Poco'],
      [/^honor\b/i, 'Xiaomi · Redmi · Poco'],
      [/^infinix\b/i, 'Xiaomi · Redmi · Poco'],
      [/^oppo\b/i, 'Xiaomi · Redmi · Poco'],
      [/^(?:tecno|spark)\b/i, 'Xiaomi · Redmi · Poco'],
    ];
    return rules.find(([pattern]) => pattern.test(name))?.[1] || null;
  };
  const parsePrice = (value: string) => {
    const normalized = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };

  const cleanImportedName = (value: string) => value
    .replace(/\*/g, '').replace(/[_~`]/g, '').replace(/[🇧🇷🇨🇳☀️😍🤩🟢⚠️‼️]/gu, '')
    .replace(/^[^A-Za-zÀ-ÿ0-9]+/, '')
    .replace(/\(\s*R?\$?.*$/i, '').replace(/\s*[-–—,:;]+\s*$/, '').replace(/[：:]+$/, '').trim();

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
    const entries: { name: string; cost: number | null; resale: number | null; colors: string[]; aliases: string[] }[] = [];
    let brand = '';
    let current: { name: string; cost: number | null; resale: number | null; colors: string[]; generic: number | null } | null = null;
    const flush = () => {
      if (!current) return;
      if (current.name && (current.cost != null || current.resale != null || current.generic != null)) {
        const aliases = [current.name];
        if (brand && !new RegExp(`^${brand}\\b`, 'i').test(current.name)) aliases.push(`${brand} ${current.name}`);
        entries.push({ name: current.name, cost: current.cost ?? current.generic, resale: current.resale, colors: current.colors, aliases });
      }
      current = null;
    };
    const numberFromLine = (line: string, labels: string[]) => {
      const label = labels.join('|');
      const match = line.match(new RegExp(`(?:${label})\\s*:?\\s*R?\\$?\\s*([\\d.]+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)`, 'i'));
      return match ? parsePrice(match[1]) : null;
    };
    const genericMatch = (line: string) => line.match(/^(.*?)(?:\s*[-–—:]\s*|\s+)(?:R?\$\s*)?([\d.]+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*$/i);

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const detectedBrand = sectionBrand(line);
      if (detectedBrand) { flush(); brand = detectedBrand; continue; }

      const vendorPrice = line.match(/\(\s*R?\$\s*([^)]*)\)/i);
      if (vendorPrice) {
        flush();
        const name = cleanImportedName(line.slice(0, vendorPrice.index ?? 0));
        const vendorCost = parsePrice(vendorPrice[1]);
        const aliases = [name];
        if (brand && name && !new RegExp(`^${brand}\\b`, 'i').test(name)) aliases.push(`${brand} ${name}`);
        if (name && vendorCost != null) entries.push({ name, cost: vendorCost, resale: null, colors: extractColors(line.slice((vendorPrice.index ?? 0) + vendorPrice[0].length)), aliases });
        continue;
      }

      const cost = numberFromLine(line, ['custo', 'cost', 'preço de custo', 'preco de custo']);
      const resale = numberFromLine(line, ['venda sugerida', 'venda', 'revenda', 'resale', 'preço de venda', 'preco de venda']);
      if (current && (cost != null || resale != null)) {
        current.cost = current.cost ?? cost;
        current.resale = current.resale ?? resale;
        current.colors = [...new Set([...current.colors, ...extractColors(line)])];
        continue;
      }

      if (cost != null || resale != null) {
        const name = cleanImportedName(line.split(/\b(?:custo|venda sugerida|venda|revenda|resale|preço de custo|preco de custo|preço de venda|preco de venda)\b/i)[0].replace(/[-–—:]+\s*$/, ''));
        if (name && !/^(?:custo|venda|revenda|resale|preço|preco)$/i.test(name)) {
          const aliases = [name];
          if (brand && !new RegExp(`^${brand}\\b`, 'i').test(name)) aliases.push(`${brand} ${name}`);
          entries.push({ name, cost, resale, colors: extractColors(line), aliases });
        }
        continue;
      }

      const oneLine = genericMatch(line);
      if (oneLine) {
        flush();
        const name = cleanImportedName(oneLine[1]);
        const price = parsePrice(oneLine[2]);
        if (name && price > 0) {
          const aliases = [name];
          if (brand && !new RegExp(`^${brand}\\b`, 'i').test(name)) aliases.push(`${brand} ${name}`);
          entries.push({ name, cost: null, resale: price, colors: extractColors(line), aliases });
        }
        continue;
      }

      if (/^(?:custo|venda|revenda|resale|preço|preco)\b/i.test(line)) continue;
      flush();
      current = { name: cleanImportedName(line), cost: null, resale: null, colors: extractColors(line), generic: null };
    }
    flush();
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
    const byName = new Map<string, Product>();
    products.forEach(product => {
      const keys = [product.name, product.name.replace(/\s*\([^)]*\)\s*$/g, '')];
      keys.forEach(key => byName.set(normalizeSupplierProductName(key).replace(/\bsansung\b/g, 'samsung'), product));
    });
    const { data: categoryNodes } = await (supabase as any).from('product_categories').select('id, name, parent_id').eq('tenant_id', supplier.tenant_id).limit(200);
    const normalizedCategory = (value: string) => normalizeProductName(value).replace(/[·•]/g, '').replace(/\s+/g, ' ').trim();
    const rootCategory = (categoryNodes || []).find((node: any) => !node.parent_id && normalizedCategory(node.name) === 'celulares');
    const updated: string[] = [];
    const notFound: string[] = [];
    const invalid: string[] = [];
    const warnings: string[] = [];
    try {
      for (const entry of entries) {
        const product = entry.aliases.map(alias => byName.get(normalizeSupplierProductName(alias).replace(/\bsansung\b/g, 'samsung'))).find(Boolean);
        if (!product) { notFound.push(entry.name); continue; }
        const patch: Record<string, any> = {};
        if ((priceUpdateMode === 'cost' || priceUpdateMode === 'both') && entry.cost != null) patch.original_price = entry.cost;
        if ((priceUpdateMode === 'resale' || priceUpdateMode === 'both') && entry.resale != null) patch.price = entry.resale;
        if (Object.keys(patch).length === 0) {
          const expected = priceUpdateMode === 'cost' ? 'CUSTO' : priceUpdateMode === 'resale' ? 'REVENDA' : 'CUSTO ou REVENDA';
          invalid.push(`${entry.name} (não contém ${expected})`);
          continue;
        }
        const category = inferProductCategory(entry.name);
        if (category) {
          const brandNode = (categoryNodes || []).find((node: any) => node.parent_id === rootCategory?.id && normalizedCategory(node.name) === normalizedCategory(category));
          patch.category = rootCategory?.name || 'Celulares';
          patch.subcategory = brandNode?.name || category;
          patch.subcategory_ids = rootCategory ? [rootCategory.id, ...(brandNode ? [brandNode.id] : [])] : null;
        }
        const { error } = await supabase.from('products').update(patch).eq('id', product.id).eq('supplier_id', supplier.id);
        if (error) { invalid.push(`${entry.name} (${error.message})`); continue; }
        if ((priceUpdateMode === 'cost' || priceUpdateMode === 'both') && entry.cost != null) {
          const { error: priceError } = await (supabase as any).from('supplier_product_prices').upsert({
            supplier_id: supplier.id,
            product_name: product.name.trim().toLowerCase(),
            unit_price: entry.cost,
            available: true,
          }, { onConflict: 'supplier_id,product_name' });
          // A tabela de comparação é auxiliar: não deve fazer a atualização do produto parecer falha.
          if (priceError) warnings.push(`${entry.name} (comparação não atualizada: ${priceError.message})`);
        }
        updated.push(entry.name);
        if (entry.colors.length > 0) {
          const { data: existingVariants, error: variantsReadError } = await (supabase as any).from('product_variants').select('id, name').eq('product_id', product.id).limit(100);
          if (variantsReadError) {
            warnings.push(`${entry.name} (cores não atualizadas: ${variantsReadError.message})`);
          } else {
            const existingNames = new Set((existingVariants || []).map((variant: any) => normalizeProductName(String(variant.name).replace(/^cor\s*:\s*/i, ''))));
            for (const color of entry.colors) {
              if (existingNames.has(normalizeProductName(color))) continue;
              const { error: variantError } = await (supabase as any).from('product_variants').insert({ product_id: product.id, tenant_id: supplier.tenant_id, name: color, price_delta: 0, in_stock: true });
              if (variantError) warnings.push(`${entry.name} (cor ${color} não atualizada: ${variantError.message})`);
              else existingNames.add(normalizeProductName(color));
            }
          }
        }
        Object.assign(product, patch);
      }
      setProducts([...products]);
      setImportResult({ updated, notFound, invalid, warnings });
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
              <p className="text-xs text-muted-foreground">Cole a lista original do fornecedor ou escolha um arquivo .txt. O valor entre parênteses é o custo e as cores após o preço também são importadas. Só serão atualizados produtos já vinculados a este fornecedor.</p>
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
                <label className="block text-xs font-semibold text-foreground">O que deseja atualizar?</label>
                <select value={priceUpdateMode} onChange={e => { setPriceUpdateMode(e.target.value as 'cost' | 'resale' | 'both'); setImportResult(null); }} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="cost">Somente preço de custo</option>
                  <option value="resale">Somente preço de revenda</option>
                  <option value="both">Preço de custo e revenda</option>
                </select>
                <p className="text-[11px] text-muted-foreground">Produtos não vinculados ao fornecedor serão ignorados. No modo “somente custo”, o preço de revenda permanece inalterado.</p>
              </div>
              <div className="rounded-md bg-secondary/60 p-3 text-xs text-muted-foreground font-mono">🇧🇷 *Galaxy A07 128GB - (R$ 750)* preto</div>
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
                {importResult.warnings.length > 0 && <p className="text-xs text-orange-300">Avisos auxiliares: {importResult.warnings.join(', ')}</p>}
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
