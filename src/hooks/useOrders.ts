import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { isVisibleOrder } from '@/lib/order-status';
import { triggerSync } from '@/hooks/useIntegration';
import { recordOrderRevenue } from '@/lib/order-finance';

export type Order = Tables<'orders'>;
export type OrderItem = Tables<'order_items'>;
export type OrderWithItems = Order & { order_items: OrderItem[] };

export const useOrders = (tenantId?: string) => {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['orders', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data as OrderWithItems[]) || []).filter(isVisibleOrder).map(o => ({
        ...o,
        delivery_fee: Number(o.delivery_fee) || 0,
        platform_fee: Number(o.platform_fee) || 0,
        total: Number(o.total) || 0,
        discount_amount: Number(o.discount_amount) || 0
      }));
    },
    enabled: !!tenantId,
    // Polling lento de fallback (caso o WebSocket caia). Realtime cuida do tempo real.
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  // Realtime: invalida cache na hora que orders/order_items mudam pro tenant.
  // Usamos um nome de canal único por montagem pra evitar o erro
  // "cannot add 'postgres_changes' callbacks ... after subscribe()" que
  // acontece quando React StrictMode (ou re-render rápido) tenta reaproveitar
  // um canal já inscrito antes do cleanup terminar.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    const channelName = `orders-rt-${tenantId}-${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase.channel(channelName);

    // 🛡️ Gap-fill: ao (re)conectar, força refetch pra pegar tudo que
    // mudou enquanto o socket estava caído. Cobre o caso "reconnect realtime".
    const refetchAll = () => {
      if (cancelled) return;
      qc.invalidateQueries({ queryKey: ['orders', tenantId] });
      qc.invalidateQueries({ queryKey: ['all-orders'] });
    };

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        refetchAll,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        refetchAll,
      )
      .subscribe((status) => {
        // SUBSCRIBED dispara no connect inicial e em todo reconnect — perfeito pro gap-fill
        if (status === 'SUBSCRIBED') refetchAll();
      });

    // Também reage à janela voltando ao foco / rede voltando
    const onOnline = () => refetchAll();
    const onVisible = () => { if (document.visibilityState === 'visible') refetchAll(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [tenantId, qc]);


  return query;
};

export const useAllOrders = ({ includeItems = false, refetchInterval = 30000 }: { includeItems?: boolean; refetchInterval?: number } = {}) => {
  return useQuery({
    queryKey: ['all-orders', includeItems],
    queryFn: async () => {
      const query = includeItems
        ? supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
        : supabase.from('orders').select('*').order('created_at', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return ((data as unknown as OrderWithItems[]) || []).filter(isVisibleOrder).map(o => ({
        ...o,
        delivery_fee: Number(o.delivery_fee) || 0,
        platform_fee: Number(o.platform_fee) || 0,
        total: Number(o.total) || 0,
        discount_amount: Number(o.discount_amount) || 0
      }));
    },
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: Math.max(10000, Math.floor(refetchInterval / 2)),
  });
};

export const useAddOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      order: Omit<Order, 'id' | 'created_at' | 'updated_at'>;
      items: {
        product_name: string;
        product_price: number;
        quantity: number;
        variant_name?: string | null;
        addons?: any;
        notes?: string | null;
      }[];
    }) => {
      // Usa RPC segura: cliente anônimo não tem permissão de leitura em orders,
      // então o insert com .select() falhava por RLS.
      const { data: newId, error: rpcError } = await (supabase as any).rpc('place_order', {
        _order: params.order as any,
        _items: params.items as any,
      });
      if (rpcError) throw rpcError;

      return { id: newId as string, ...(params.order as any) } as Order;
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['orders', data.tenant_id] });
      qc.invalidateQueries({ queryKey: ['all-orders'] });
      // Se o pedido já nasce entregue (venda balcão modo "instant"), registra
      // receita e dispara sync — esses fluxos não passam por updateStatus.
      if (data?.status === 'delivered') {
        try {
          await recordOrderRevenue(data as any);
          triggerSync(data.tenant_id, 'order_delivered', data);
        } catch (e) { console.warn('order revenue/sync failed', e); }
      }
    },
  });
};

// Mapeamento do status de Operação para o estado do KDS (painel da cozinha).
// Operação e KDS usam colunas independentes; sem essa sincronização, o pedido
// avança na Operação mas continua "Na fila" no KDS.
export const kdsPatchForStatus = (status: string): Record<string, any> | null => {
  if (status === 'preparing') {
    return { kds_status: 'preparing' as const };
  }
  if (status === 'received' || status === 'pending_review') {
    return { kds_status: 'queue' as const };
  }
  if (status === 'ready-for-pickup') {
    return { kds_status: 'ready' as const };
  }
  if (status === 'delivered' || status === 'cancelled' || status === 'out-for-delivery') {
    // Saiu para entrega → já passou pela cozinha, remove da tela do KDS.
    return { kds_status: 'done' as const };
  }
  return null;
};

export const useUpdateOrderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, driver_id }: { id: string; status: string; driver_id?: string }) => {
      // Sincronização Operação ↔ KDS: o painel de Operação (tenant) e o KDS
      // (cozinha) têm colunas independentes. Se o painel avança o status sem
      // atualizar o kds_status, o KDS continua mostrando o pedido "Na fila"
      // enquanto a Operação já diz "Em Preparo". Sincronizamos aqui.
      const kdsPatch = kdsPatchForStatus(status) || {};
      // Marca o início do preparo no KDS apenas se ainda não registrado
      if (kdsPatch.kds_status === 'preparing') {
        const { data: existing } = await supabase.from('orders').select('kds_started_at').eq('id', id).maybeSingle();
        if (existing && !existing.kds_started_at) kdsPatch.kds_started_at = new Date().toISOString();
      }
      const { error } = await supabase.from('orders').update({
        status,
        ...(driver_id !== undefined ? { driver_id } : {}),
        ...(kdsPatch.kds_status ? kdsPatch : {}),
      }).eq('id', id);
      if (error) throw error;
      // Quando vira "delivered", registra receita financeira (idempotente)
      // e dispara sincronização pra FinanceFlow.
      if (status === 'delivered') {
        const { data: order } = await supabase.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle();
        if (order?.tenant_id) {
          try { await recordOrderRevenue(order as any); } catch (e) { console.warn('record revenue failed', e); }
          triggerSync(order.tenant_id, 'order_delivered', order);
        }
      }
      // Quando vira "cancelled", avisa FinanceFlow pra estornar (evita receita fantasma)
      // e devolve o estoque consumido pelos itens do pedido (o decremento acontece
      // no checkout da loja pública — sem a devolução, o produto ficaria zerado
      // mesmo com o pedido cancelado).
      if (status === 'cancelled') {
        const { data: order } = await supabase.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle();
        if (order?.tenant_id) {
          triggerSync(order.tenant_id, 'order_cancelled', order);
        }
        const items = (order as any)?.order_items as any[] | undefined;
        if (items?.length) {
          const byProduct = new Map<string, number>();
          items.forEach(it => byProduct.set(it.product_id, (byProduct.get(it.product_id) || 0) + (it.quantity || 1)));
          for (const [productId, qty] of byProduct) {
            const { data: prod } = await supabase.from('products').select('stock_quantity').eq('id', productId).maybeSingle();
            if (prod && prod.stock_quantity != null) {
              const newQty = Number(prod.stock_quantity) + qty;
              await supabase.from('products').update({ stock_quantity: newQty, in_stock: newQty > 0 } as any).eq('id', productId);
            }
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['all-orders'] });
    },
  });
};

export const useDeleteOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('order_items').delete().eq('order_id', id);
      const { error } = await supabase.from('orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['all-orders'] });
    },
  });
};
