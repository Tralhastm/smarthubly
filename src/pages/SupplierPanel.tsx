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
import SupplierProfileSettings from '@/components/tenant/SupplierProfileSettings';
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
  metadata?: any;
  supplier_batch_sent?: Record<string, string>;
  order_items: { id: string; product_name: string; product_price: number; quantity: number }[];
};

type Product = {
  id: string; name: string; price: number; original_price?: number | null; in_stock: boolean; category: string; supplier_id: string | null;
  subcategory?: string | null; subcategory_ids?: string[] | null;
  stock_quantity: number | null;
  supplierVariants?: { id: string; name: string; in_stock: boolean; unit_cost: number | null }[];
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
  const [tab, setTab] = useState<'orders' | 'deliveries' | 'stock' | 'import-export' | 'chats' | 'reviews' | 'lalamove' | 'shipping' | 'drivers' | 'profile'>('orders');
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
  const [batchSending, setBatchSending] = useState(false);
  const [selectedBatchOrders, setSelectedBatchOrders] = useState<Set<string>>(new Set());
  const [priceText, setPriceText] = useState('');
  const [priceUpdateMode, setPriceUpdateMode] = useState<'cost' | 'resale' | 'both' | 'color'>('cost');
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
    // Mostra produtos próprios e também produtos nos quais este fornecedor
    // possui uma oferta por cor/custo menor.
    const [{ data: own }, { data: offers }] = await Promise.all([
      supabase.from('products').select('id, name, price, original_price, in_stock, category, subcategory, subcategory_ids, supplier_id, stock_quantity')
        .eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id),
      (supabase as any).from('supplier_variant_offers').select('product_id, product_variant_id, unit_cost')
        .eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id).eq('available', true).limit(500),
    ]);
    const ids = Array.from(new Set(((offers || []) as any[]).map(o => o.product_id).filter(Boolean)));
    const variantIds = Array.from(new Set(((offers || []) as any[]).map(o => o.product_variant_id).filter(Boolean)));
    const [{ data: offered }, { data: variants }] = await Promise.all([
      ids.length
        ? supabase.from('products').select('id, name, price, original_price, in_stock, category, subcategory, subcategory_ids, supplier_id, stock_quantity').in('id', ids)
        : Promise.resolve({ data: [] as any[] } as any),
      variantIds.length
        ? (supabase as any).from('product_variants').select('id, product_id, name, in_stock').in('id', variantIds)
        : Promise.resolve({ data: [] as any[] } as any),
    ]);
    const costByVariant = new Map(((offers || []) as any[]).map(o => [o.product_variant_id, Number(o.unit_cost)]));
    const variantsByProduct = new Map<string, Product['supplierVariants']>();
    ((variants || []) as any[]).forEach(v => {
      const list = variantsByProduct.get(v.product_id) || [];
      list.push({ id: v.id, name: v.name, in_stock: v.in_stock === true || String(v.in_stock) === 'true', unit_cost: costByVariant.get(v.id) ?? null });
      variantsByProduct.set(v.product_id, list);
    });
    const merged = new Map<string, Product>();
    [...((own as any[]) || []), ...((offered as any[]) || [])].forEach(p => merged.set(p.id, { ...(p as Product), supplierVariants: variantsByProduct.get(p.id) || [] }));
    setProducts([...merged.values()]);
  }, [supplier]);

  const fetchOrdersRef = useRef<() => Promise<void>>(async () => {});

  const fetchOrders = useCallback(async () => {
    if (!supplier) return;
    try {
      // Produtos próprios + produtos em que o fornecedor possui oferta por cor.
      const { data: offerRows } = await (supabase as any).from('supplier_variant_offers')
        .select('product_id').eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id).limit(500);
      const offeredIds = Array.from(new Set(((offerRows || []) as any[]).map(o => o.product_id).filter(Boolean)));
      const ownQuery = supabase.from('products').select('id, name, price, original_price, in_stock, category, subcategory, subcategory_ids, supplier_id, stock_quantity')
        .eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id);
      const offeredQuery = offeredIds.length
        ? supabase.from('products').select('id, name, price, original_price, in_stock, category, subcategory, subcategory_ids, supplier_id, stock_quantity').in('id', offeredIds)
        : Promise.resolve({ data: [] as any[], error: null } as any);
      const [{ data: ownProducts }, { data: offeredProducts }] = await Promise.all([ownQuery, offeredQuery]);
      const productsById = new Map<string, Product>();
      [...((ownProducts as any[]) || []), ...((offeredProducts as any[]) || [])].forEach(p => productsById.set(p.id, p as Product));
      const freshProducts = [...productsById.values()];
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

      // Filter seguro: pedido direto deste fornecedor, fragmento destinado a ele
      // ou item individual roteado para ele. Em pedidos mistos, cada item já
      // carrega o fornecedor vencedor mesmo quando o fragmento ainda não existe.
      // O endereço continua visível aqui no painel autenticado pelo token; ele não
      // é usado na mensagem de WhatsApp.
      const allOrders = (data as any[]) || [];
      const { data: fragments } = await (supabase as any).from('order_fragments')
        .select('order_id, items').eq('supplier_id', supplier.id).limit(500);
      const fragmentByOrder = new Map<string, any>();
      ((fragments || []) as any[]).forEach(f => fragmentByOrder.set(f.order_id, f));
      const relevantOrders = allOrders.filter(o =>
        o.supplier_id === supplier.id ||
        fragmentByOrder.has(o.id) ||
        (o.order_items || []).some((i: any) => i.supplier_id === supplier.id)
      )
        .map(o => {
          const fragment = fragmentByOrder.get(o.id);
          if (fragment?.items) {
            const allowed = new Set((fragment.items || []).map((i: any) => `${i.product_name}::${i.variant_name || ''}`));
            return { ...o, order_items: (o.order_items || []).filter((i: any) => allowed.has(`${i.product_name}::${i.variant_name || ''}`)) };
          }
          const hasRoutedItems = (o.order_items || []).some((i: any) => i.supplier_id);
          if (hasRoutedItems) {
            return { ...o, order_items: (o.order_items || []).filter((i: any) => i.supplier_id === supplier.id) };
          }
          return o;
        }) as OrderWithItems[];

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
      setSelectedBatchOrders(prev => {
        const next = new Set(prev);
        relevantOrders.forEach((o: any) => {
          if (!o.supplier_batch_sent?.[supplier.id]) next.add(o.id);
          else next.delete(o.id);
        });
        return next;
      });

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

  const sendDailySupplierBatch = async () => {
    if (!supplier || batchSending) return;
    setBatchSending(true);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.from('orders')
        .select('id, created_at, customer_name, metadata, supplier_batch_sent')
        .eq('tenant_id', supplier.tenant_id)
        .gte('created_at', start.toISOString())
        .not('status', 'in', '(cancelled,canceled)')
        .order('created_at', { ascending: true }).limit(500);
      if (error) throw error;
      const orders = ((data || []) as any[]).map(order => ({
        order,
        items: order.metadata?.fragmentation_map?.[supplier.id] || [],
      })).filter(x => selectedBatchOrders.has(x.order.id) && Array.isArray(x.items) && x.items.length > 0);
      if (!orders.length) { toast.info('Nenhum pedido deste fornecedor hoje.'); return; }

      const variantIds = Array.from(new Set(orders.flatMap(x => x.items.map((i: any) => i.variantId).filter(Boolean))));
      const { data: offers } = variantIds.length
        ? await (supabase as any).from('supplier_variant_offers').select('product_variant_id, unit_cost')
          .eq('tenant_id', supplier.tenant_id).eq('supplier_id', supplier.id)
          .in('product_variant_id', variantIds).limit(500)
        : { data: [] as any[] };
      const costs = new Map(((offers || []) as any[]).map(o => [o.product_variant_id, Number(o.unit_cost)]));
      const money = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      let totalDue = 0;
      let totalUnits = 0;
      const lines = [`LOTE DIÁRIO — ${supplier.name.toUpperCase()}`, `Data: ${start.toLocaleDateString('pt-BR')}`, ''];
      orders.forEach(({ items }) => {
        items.forEach((item: any) => {
          const qty = Number(item.quantity || 0);
          const cost = costs.get(item.variantId) ?? Number(item.product?.original_price ?? 0);
          const subtotal = cost * qty;
          totalUnits += qty; totalDue += subtotal;
          lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━', `Quantidade: ${qty} unidade(s)`, `Produto: ${item.product?.name || 'Não identificado'}`, `Variação: ${item.variantName || 'Única'}`, `Custo unitário: ${cost > 0 ? money(cost) : 'NÃO LOCALIZADO'}`, `Subtotal: ${cost > 0 ? money(subtotal) : 'CONFERIR'}`, '');
        });
      });
      const batchCode = `LOTE-${start.toISOString().slice(0, 10).replace(/-/g, '')}-${String(supplier.id).slice(0, 6).toUpperCase()}`;
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'TOTAL DO LOTE', `Quantidade total: ${totalUnits} unidade(s)`, `VALOR TOTAL DEVIDO AO FORNECEDOR: ${money(totalDue)}`, '', `CÓDIGO DO LOTE / MOTOBOY: ${batchCode}`, '', 'Conferir quantidade, variação, custo unitário e total antes de separar.');
      const text = lines.join('\n');
      await navigator.clipboard?.writeText(text);
      const phone = String((supplier as any).phone || '').replace(/\D/g, '');
      if (!phone) { toast.success('Lote copiado. Cadastre o telefone do fornecedor para abrir o WhatsApp.'); return; }
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      const sentAt = new Date().toISOString();
      await Promise.all(orders.map(({ order }) => supabase.from('orders').update({
        supplier_batch_sent: { ...(order.supplier_batch_sent || {}), [supplier.id]: sentAt },
      } as any).eq('id', order.id)));
      setSelectedBatchOrders(new Set());
      toast.success('Lote diário preparado e copiado para o WhatsApp.');
    } catch (e) {
      console.error('[SupplierPanel] daily batch error:', e);
      toast.error('Não foi possível gerar o lote diário.');
    } finally { setBatchSending(false); }
  };

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
      const payer = d.payer === 'supplier' ? 'fornecedor' : 'loja';
      toast.success(`✅ Lalamove acionada; aguardando início da rota. R$${d.price || '?'} (paga: ${payer})`, { id: toastId, duration: 6000 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha Lalamove: ${msg}`, { id: toastId, duration: 8000 });
    } finally {
      setAdvancingId(null);
    }
  };

  const assignDriverAndDispatch = async (orderId: string, driverId: string) => {
    if (!supplier || !token) return;
    setSelectingDriver(null);
    const currentOrder = orders.find(o => o.id === orderId);
    const wasOutForDelivery = currentOrder?.status === 'out-for-delivery';
    setAdvancingId(orderId);
    // Atualização otimista; revertida se a associação for rejeitada.
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, driver_id: driverId, lalamove_order_id: null } : o));
    try {
      const { error } = await supabase.rpc('assign_order_driver_by_supplier_token', {
        _supplier_token: token,
        _order_id: orderId,
        _driver_id: driverId,
      });
      if (error) throw error;

      toast.success(wasOutForDelivery ? 'Motoboy trocado!' : 'Pedido enviado ao painel do motoboy!');
      try {
        await unifiedInvoke("notify-unified", "push", {
          driverId,
          title: "🏍️ Novo pedido atribuído!",
          body: `Pedido #${orderId.slice(0, 6)} disponível para sua rota.`,
        });
      } catch (e) { console.error('Push falhou:', e); }
    } catch (e) {
      console.error('Falha ao associar motoboy:', e);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, driver_id: currentOrder?.driver_id ?? null } : o));
      toast.error('Não foi possível associar este motoboy. Tente novamente.');
    } finally {
      setAdvancingId(null);
    }
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
      if (orders.find(o => o.id === id)?.driver_id) {
        toast.info('Pedido já foi enviado ao motoboy. Ele deve marcar "Saiu para entrega" no próprio painel.');
        return;
      }
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
      // Nunca avance para "Saiu p/ Entrega" pelo painel do fornecedor.
      // Sem motoboy ou Lalamove, o pedido permanece visível ao cliente como
      // recebido/em preparo até que um entregador possa iniciar a rota.
      toast.error('Cadastre ou ative um motoboy para despachar este pedido.');
      return;
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

  const normalizeProductName = (value: string) => value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\d+\s*[.)-]\s*/, '')
    .replace(/[|*_]/g, ' ')
    .replace(/\s+/g, ' ');
  const normalizeSupplierProductName = (value: string) => normalizeProductName(value)
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\bnfce\b/g, 'nfc')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
  const extractColors = (value: string) => {
    const colorPattern = /\b(preto|preta|azul|verde|laranja|roxo|rosa|cinza|branco|branca|dourado|dourada|prata|marrom|vermelho|vermelha|titanium|grafite|gold|black|white|camuflada)\b/giu;
    const emojiColors: Array<[RegExp, string]> = [
      [/🔵|💙/gu, 'Azul'], [/⚫️?|🖤/gu, 'Preto'], [/🩷|💗/gu, 'Rosa'],
      [/🟣|💜/gu, 'Roxo'], [/⚪️?|🤍/gu, 'Branco'], [/🟢|💚/gu, 'Verde'],
      [/🟠|🧡/gu, 'Laranja'], [/🩶|🩵/gu, 'Cinza'], [/🌕|🟡/gu, 'Dourado'],
    ];
    const colors = [...value.matchAll(colorPattern)].map(match => match[1]);
    emojiColors.forEach(([pattern, color]) => { if (pattern.test(value)) colors.push(color); });
    return colors.filter((color, index, all) => all.findIndex(c => c.toLocaleLowerCase('pt-BR') === color.toLocaleLowerCase('pt-BR')) === index);
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
    const heading = line.replace(/[🇧🇷🇨🇳☀️😍🤩🟢⚠️‼️*\s]/gu, '');
    const isHeading = /(?:-{3,}|_{3,})/.test(line) || /^(?:REALME|SAMSUNG|MOTOROLA|INFINIX|OPPO|HONOR|REDMI|POCO|MI|NOTE)$/i.test(heading);
    if (!line.includes('🟢') && !isHeading && !/LINHA\s+(REDMI|NOTE|POCO|MI)/i.test(line)) return '';
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
    const entries: { name: string; cost: number | null; resale: number | null; colors: string[]; unavailableColors: string[]; aliases: string[] }[] = [];
    let brand = '';
    let nextUnavailable = false;
    let current: { name: string; cost: number | null; resale: number | null; colors: string[]; unavailableColors: string[]; generic: number | null } | null = null;
    const flush = () => {
      if (!current) return;
      if (current.name && (current.cost != null || current.resale != null || current.generic != null)) {
        const aliases = [current.name];
        if (brand && !new RegExp(`^${brand}\\b`, 'i').test(current.name)) aliases.push(`${brand} ${current.name}`);
        entries.push({ name: current.name, cost: current.cost ?? current.generic, resale: current.resale, colors: current.colors, unavailableColors: current.unavailableColors, aliases });
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
      let line = rawLine.trim().replace(/\*/g, '').trim();
      line = line.replace(/R\$\s*R\$/gi, 'R$');
      if (!line) continue;
      if (/^\*?\s*crit[eé]rio\s*:/i.test(line)) continue;
      const emojiOnly = line.replace(/[\s*🔵💙⚫️🖤🩷💗🟣💜⚪️🤍🟢💚🟠🧡🩶🩵🌕🟡]/gu, '') === '' && /[🔵💙⚫️🖤🩷💗🟣💜⚪️🤍🟢💚🟠🧡🩶🩵🌕🟡]/u.test(line);
      if (emojiOnly) {
        const colors = extractColors(line);
        if (current) {
          current.colors = [...new Set([...current.colors, ...colors])];
          if (nextUnavailable || current.unavailableColors.includes('__all__')) current.unavailableColors = [...new Set([...current.unavailableColors.filter(c => c !== '__all__'), ...colors])];
        } else if (entries.length) {
          entries[entries.length - 1].colors = [...new Set([...entries[entries.length - 1].colors, ...colors])];
          if (nextUnavailable || entries[entries.length - 1].unavailableColors.includes('__all__')) entries[entries.length - 1].unavailableColors = [...new Set([...entries[entries.length - 1].unavailableColors.filter(c => c !== '__all__'), ...colors])];
        }
        nextUnavailable = false;
        continue;
      }
      const availabilityMarker = /\b(?:falta|verificar\s+disponibilidade|indispon[ií]vel)\b/gi;
      const hasAvailabilityMarker = availabilityMarker.test(line);
      if (hasAvailabilityMarker) line = line.replace(availabilityMarker, ' ').replace(/\s+/g, ' ').trim();
      if (!line) {
        nextUnavailable = true;
        continue;
      }
      if (hasAvailabilityMarker) nextUnavailable = true;
      if (/^(?:🔥?\s*)?(?:promo[cç][aã]o\s+apple|apple|ipad|airpods?|apple\s+watch|macbooks?|airtag|apple\s+pencil)\s*:?\s*$/i.test(line.replace(/[🔥🎧⌚️💻]/gu, '').trim())) {
        flush();
        brand = line.toLocaleUpperCase('pt-BR').includes('APPLE') ? 'Apple' : '';
        continue;
      }
      const detectedBrand = sectionBrand(line);
      if (detectedBrand) { flush(); brand = detectedBrand; continue; }

      const vendorPrice = line.match(/\(\s*R?\$\s*([^)]*)\)/i);
      if (vendorPrice) {
        flush();
        const name = cleanImportedName(line.slice(0, vendorPrice.index ?? 0));
        const vendorCost = parsePrice(vendorPrice[1]);
        const remainder = line.slice((vendorPrice.index ?? 0) + vendorPrice[0].length);
        const vendorResale = numberFromLine(remainder, ['venda sugerida', 'venda', 'revenda', 'resale', 'preço de venda', 'preco de venda']);
        const aliases = [name];
        if (brand && name && !new RegExp(`^${brand}\\b`, 'i').test(name)) aliases.push(`${brand} ${name}`);
        if (name && vendorCost != null) {
          const colors = extractColors(remainder);
          entries.push({ name, cost: vendorCost, resale: vendorResale, colors, unavailableColors: nextUnavailable ? (colors.length ? colors : ['__all__']) : [], aliases });
          nextUnavailable = false;
        }
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
          const colors = extractColors(line);
          entries.push({ name, cost, resale, colors, unavailableColors: nextUnavailable ? (colors.length ? colors : ['__all__']) : [], aliases });
          nextUnavailable = false;
        }
        continue;
      }

      const oneLine = genericMatch(line);
      if (oneLine) {
        if (current) {
          current.generic = parsePrice(oneLine[2]);
          current.colors = [...new Set([...current.colors, ...extractColors(line)])];
          continue;
        }
        flush();
        const name = cleanImportedName(oneLine[1]);
        const price = parsePrice(oneLine[2]);
        if (name && price > 0) {
          const aliases = [name];
          if (brand && !new RegExp(`^${brand}\\b`, 'i').test(name)) aliases.push(`${brand} ${name}`);
          const colors = extractColors(line);
          // Em listas de fornecedor no formato “Produto - R$ preço”, o valor
          // é o custo de compra. Revenda só deve ser preenchida quando vier
          // explicitamente identificada como venda/revenda.
          entries.push({ name, cost: price, resale: null, colors, unavailableColors: nextUnavailable ? (colors.length ? colors : ['__all__']) : [], aliases });
          nextUnavailable = false;
        }
        continue;
      }

      if (/^(?:custo|venda|revenda|resale|preço|preco)\b/i.test(line)) continue;
      flush();
      current = { name: cleanImportedName(line), cost: null, resale: null, colors: extractColors(line), unavailableColors: nextUnavailable ? ['__all__'] : [], generic: null };
      nextUnavailable = false;
    }
    flush();
    return entries.map(entry => {
      const aliases = [...entry.aliases];
      const compact = normalizeSupplierProductName(entry.name);
      if (/^\d/.test(compact)) aliases.push(`iphone ${entry.name}`);
      // Alguns cadastros antigos guardam “IPHONE 17E” sem capacidade,
      // enquanto a lista do fornecedor informa “17E 256GB”.
      if (/^17e\b/i.test(compact)) aliases.push('iphone 17e');
      if (/^(?:se\b|serie\b|s[eé]rie\b)/i.test(compact)) aliases.push(`apple watch ${entry.name}`);
      return { ...entry, aliases: [...new Set(aliases)] };
    });
  };

  const importPrices = async () => {
    if (!supplier || importingPrices) return;
    const entries = parseImportedEntries(priceText);
    if (entries.length === 0) {
      toast.error('Nenhuma linha válida encontrada. Use: produto - CUSTO: R$ 990,00 - REVENDA: R$ 1.199,00 - cores');
      return;
    }
    setImportingPrices(true);
    const byName = new Map<string, Product>();
    products.forEach(product => {
      const keys = [product.name, product.name.replace(/\s*\([^)]*\)\s*$/g, '')];
      keys.forEach(key => byName.set(normalizeSupplierProductName(key).replace(/\bsansung\b/g, 'samsung'), product));
    });
    const updated: string[] = [];
    const notFound: string[] = [];
    const invalid: string[] = [];
    const warnings: string[] = [];
    const incomingByProduct = new Map<string, Set<string>>();
    try {
      for (const entry of entries) {
        const product = entry.aliases.map(alias => byName.get(normalizeSupplierProductName(alias).replace(/\bsansung\b/g, 'samsung'))).find(Boolean);
        if (!product) { notFound.push(entry.name); continue; }
        const patch: Record<string, any> = {};
        if ((priceUpdateMode === 'cost' || priceUpdateMode === 'both') && entry.cost != null) patch.original_price = entry.cost;
        if ((priceUpdateMode === 'resale' || priceUpdateMode === 'both') && entry.resale != null) patch.price = entry.resale;
        if (Object.keys(patch).length === 0 && entry.colors.length === 0) {
          const expected = priceUpdateMode === 'color' ? 'CUSTO por cor' : priceUpdateMode === 'cost' ? 'CUSTO' : priceUpdateMode === 'resale' ? 'REVENDA' : 'CUSTO ou REVENDA';
          invalid.push(`${entry.name} (não contém ${expected})`);
          continue;
        }
        if (Object.keys(patch).length > 0 && product.supplier_id === supplier.id) {
          const { error } = await supabase.from('products').update(patch).eq('id', product.id).eq('supplier_id', supplier.id);
          if (error) { invalid.push(`${entry.name} (${error.message})`); continue; }
        }
        // Cada cor é uma oferta independente. Nunca apagamos a variante de
        // outro fornecedor; apenas atualizamos/criamos a oferta deste fornecedor.
        {
          const { data: existingVariants, error: variantsReadError } = await (supabase as any).from('product_variants').select('id, name').eq('product_id', product.id).limit(100);
          if (variantsReadError) {
            warnings.push(`${entry.name} (cores não atualizadas: ${variantsReadError.message})`);
          } else {
            const incomingNames = new Set<string>();
            for (const color of entry.colors) {
              const normalizedColor = normalizeProductName(color);
              const unavailable = entry.unavailableColors.some(c => normalizeProductName(c) === normalizedColor);
              incomingNames.add(normalizedColor);
              const old = (existingVariants || []).find((variant: any) => normalizeProductName(String(variant.name).replace(/^cor\s*:\s*/i, '')) === normalizedColor);
              const variantPatch: Record<string, any> = { in_stock: !unavailable };
              if ((priceUpdateMode === 'resale' || priceUpdateMode === 'both') && entry.resale != null) {
                variantPatch.suggested_price = entry.resale;
                variantPatch.price_delta = entry.resale - Number(product.price || 0);
              }
              const { error: variantError } = old
                ? await (supabase as any).from('product_variants').update(variantPatch).eq('id', old.id)
                : await (supabase as any).from('product_variants').insert({ product_id: product.id, tenant_id: supplier.tenant_id, name: color, price_delta: priceUpdateMode === 'resale' && entry.resale != null ? entry.resale - Number(product.price || 0) : 0, suggested_price: priceUpdateMode !== 'cost' ? entry.resale : null, in_stock: true, sort_order: entry.colors.indexOf(color) });
              if (variantError) warnings.push(`${entry.name} (cor ${color} não atualizada: ${variantError.message})`);
              const variant = old || (await (supabase as any).from('product_variants').select('id').eq('product_id', product.id).eq('name', color).limit(1).maybeSingle()).data;
              if (variant?.id && entry.cost != null && Number(entry.cost) > 0) {
                const { error: offerError } = await (supabase as any).rpc('upsert_supplier_variant_offer_by_token', {
                  _token: token,
                  _product_id: product.id,
                  _product_variant_id: variant.id,
                  _variant_name: color,
                  _variant_key: normalizedColor,
                  _unit_cost: Number(entry.cost),
                  _available: !unavailable,
                  _source: 'supplier_panel',
                });
                if (offerError) warnings.push(`${entry.name} (oferta da cor ${color} não atualizada: ${offerError.message})`);
              }
            }
            const allIncoming = incomingByProduct.get(product.id) || new Set<string>();
            incomingNames.forEach(name => allIncoming.add(name));
            incomingByProduct.set(product.id, allIncoming);
          }
        }
        updated.push(entry.name);
        Object.assign(product, patch);
      }
      for (const [productId, incomingKeys] of incomingByProduct) {
        const { error: staleError } = await (supabase as any).rpc('hide_stale_supplier_variant_offers_by_token', {
          _token: token,
          _product_id: productId,
          _incoming_keys: [...incomingKeys],
        });
        if (staleError) {
          warnings.push(`Produto ${productId} (cores ausentes não ocultadas: ${staleError.message})`);
        }
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
          shipping: 'config', lalamove: 'config', profile: 'config',
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
              { id: 'profile' as const, label: 'Meus dados', icon: <User className="h-4 w-4" />, group: 'config' as const },
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
                profile: 'supplierProfile',
              };
              return <HelpButton topic={HELP_TOPIC[tab]} label="Como usar" />;
            })()}
          </div>
        </div>

        {tab === 'orders' && (
          <div className="space-y-4">
            {orders.length > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={orders.every(o => selectedBatchOrders.has(o.id))}
                    onChange={e => setSelectedBatchOrders(e.target.checked ? new Set(orders.map(o => o.id)) : new Set())}
                    className="h-4 w-4 accent-primary"
                  />
                  Selecionar tudo
                </label>
                <span className="text-xs text-muted-foreground">{selectedBatchOrders.size} selecionado(s)</span>
              </div>
            )}
            <button
              onClick={sendDailySupplierBatch}
              disabled={batchSending}
              className="w-full rounded-lg border border-green-500/40 bg-green-500/10 text-green-400 py-2.5 text-sm font-semibold hover:bg-green-500/20 disabled:opacity-50"
            >
              {batchSending ? 'Montando lote diário...' : '📲 Enviar lote do dia pelo WhatsApp'}
            </button>
            {orders.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum pedido ativo.</p>}
            {orders.map(order => {
              const cfg = statusConfig[order.status] || statusConfig.received;
              return (
                <div key={order.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="checkbox"
                        checked={selectedBatchOrders.has(order.id)}
                        onChange={e => setSelectedBatchOrders(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(order.id); else next.delete(order.id);
                          return next;
                        })}
                        className="h-4 w-4 accent-primary"
                        title="Incluir no lote do WhatsApp"
                      />
                      <Package className="h-4 w-4 text-primary" />
                      <span className="font-medium text-foreground text-sm">#{order.id.slice(0, 6)}</span>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                      {order.supplier_batch_sent?.[supplier.id] && (
                        <span className="rounded-full bg-green-500/20 text-green-400 px-2 py-0.5 text-[11px] font-bold">✓ Já enviado</span>
                      )}
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
                        <button type="button" key={d.id} onClick={() => assignDriverAndDispatch(order.id, d.id)} disabled={advancingId === order.id}
                          aria-label={`Selecionar motoboy ${d.name}`}
                          className="w-full flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-sm text-foreground hover:border-primary transition-colors">
                          <Truck className="h-4 w-4 text-primary" />
                          <span>{advancingId === order.id ? 'Associando...' : d.name}</span>
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
                      {advancingId === order.id
                        ? 'Despachando...'
                        : getNextStatus(order.status, order.delivery_type) === 'out-for-delivery'
                          ? 'Despachar motoboy'
                          : `Avançar → ${statusConfig[getNextStatus(order.status, order.delivery_type)!]?.label}`}
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
                {(p.supplierVariants?.length ?? 0) > 0 && (
                  <div className="rounded-md border border-border/60 bg-secondary/30 px-2.5 py-2 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Variações vencedoras deste fornecedor
                    </p>
                    {p.supplierVariants!.map(v => (
                      <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-foreground truncate">{v.name}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          {v.unit_cost != null && <span className="text-muted-foreground">Custo R${v.unit_cost.toFixed(2)}</span>}
                          <span className={v.in_stock ? 'text-green-400' : 'text-red-400'}>
                            {v.in_stock ? 'Disponível' : 'Esgotada'}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
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
                <select value={priceUpdateMode} onChange={e => { setPriceUpdateMode(e.target.value as 'cost' | 'resale' | 'both' | 'color'); setImportResult(null); }} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="cost">Somente preço de custo</option>
                  <option value="resale">Somente preço de revenda</option>
                  <option value="both">Preço de custo e revenda</option>
                  <option value="color">Seletor por cor — custo e disponibilidade</option>
                </select>
                <p className="text-[11px] text-muted-foreground">No Seletor por cor, uma cor nova pode ser criada. O custo fica registrado para este fornecedor; o sistema escolhe o menor custo sem vender abaixo do preço da loja. Se empatar, vence quem já recebeu mais pedidos daquela cor.</p>
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

        {tab === 'profile' && (
          <SupplierProfileSettings
            supplier={supplier}
            onSaved={(changes) => Object.assign(supplier as any, changes)}
          />
        )}
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
