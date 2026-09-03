import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type StoreHealthRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  total_orders: number;
  delivered: number;
  cancelled: number;
  cancel_rate: number;
  avg_ticket: number;
  gross_revenue: number;
  platform_fee_total: number;
  auto_advance_count: number;
  auto_assign_count: number;
  manual_count: number;
  automation_rate: number;
  avg_received_to_preparing_min: number | null;
  avg_preparing_to_out_min: number | null;
  avg_out_to_delivered_min: number | null;
  avg_total_min: number | null;
};

const diffMinutes = (a: string, b: string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 60000;

// Máximo aceitável para uma etapa do pedido (24 horas). Transições acima
// disso são artefato de carimbo ausente (o passo anterior usa created_at)
// ou pedido atípico — não devem inflar a média.
const MAX_STEP_MIN = 24 * 60;

const avg = (xs: number[]) => {
  const sane = xs.filter(x => x >= 0 && x <= MAX_STEP_MIN);
  return sane.length === 0 ? null : Math.round((sane.reduce((s, x) => s + x, 0) / sane.length) * 10) / 10;
};

export const useStoreHealth = (sinceDays = 30) => {
  return useQuery({
    queryKey: ['store-health', sinceDays],
    queryFn: async (): Promise<StoreHealthRow[]> => {
      const since = new Date(Date.now() - sinceDays * 86400000).toISOString();

      const [tenantsRes, ordersRes, eventsRes] = await Promise.all([
        supabase.from('tenants').select('id, name, slug'),
        supabase.from('orders').select('id, tenant_id, status, total, platform_fee, created_at, updated_at').gte('created_at', since),
        (supabase as any).from('order_events').select('order_id, tenant_id, event_type, from_status, to_status, actor, created_at').gte('created_at', since),
      ]);

      if (tenantsRes.error) throw tenantsRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const tenants = tenantsRes.data || [];
      const orders = ordersRes.data || [];
      const events = (eventsRes.data || []) as any[];

      // group events by order_id, sorted by time
      const eventsByOrder = new Map<string, any[]>();
      events.forEach(e => {
        const list = eventsByOrder.get(e.order_id) || [];
        list.push(e);
        eventsByOrder.set(e.order_id, list);
      });
      eventsByOrder.forEach(list => list.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)));

      return tenants.map(t => {
        const tOrders = orders.filter(o => o.tenant_id === t.id);
        const total_orders = tOrders.length;
        const delivered = tOrders.filter(o => o.status === 'delivered').length;
        const cancelled = tOrders.filter(o => o.status === 'cancelled').length;
        const gross_revenue = tOrders.reduce((s, o) => s + Number(o.total || 0), 0);
        const platform_fee_total = tOrders.reduce((s, o) => s + Number(o.platform_fee || 0), 0);
        const avg_ticket = total_orders > 0 ? gross_revenue / total_orders : 0;
        const cancel_rate = total_orders > 0 ? (cancelled / total_orders) * 100 : 0;

        // automation: count events for this tenant
        const tEvents = events.filter(e => e.tenant_id === t.id);
        const auto_advance_count = tEvents.filter(e => e.event_type === 'auto_advance' || (e.event_type === 'status_change' && e.actor === 'system')).length;
        const auto_assign_count = tEvents.filter(e => e.event_type === 'auto_assign_supplier').length;
        const manual_count = tEvents.filter(e => e.event_type === 'status_change' && e.actor === 'admin').length;
        const total_transitions = auto_advance_count + auto_assign_count + manual_count;
        const automation_rate = total_transitions > 0
          ? ((auto_advance_count + auto_assign_count) / total_transitions) * 100
          : 0;

        // step times: per delivered order, find timestamps of status transitions
        const recv2prep: number[] = [];
        const prep2out: number[] = [];
        const out2delivered: number[] = [];
        const totals: number[] = [];

        tOrders.filter(o => o.status === 'delivered').forEach(o => {
          // Ignora pedidos de teste/demonstração (prefixos de marcador)
          const name = (o.customer_name || '').toLowerCase();
          if (/\bteste|\bdemo\b|manus/.test(name)) return;
          const list = eventsByOrder.get(o.id) || [];
          // Usa o carimbo real do evento 'received' quando existe;
          // created_at só vira carimbo de 'received' se o pedido foi aprovado
          // logo após a criação (janela de 30 min).
          const stamps: Record<string, string> = {};
          list.forEach(ev => {
            if (ev.to_status && !stamps[ev.to_status]) stamps[ev.to_status] = ev.created_at;
          });
          if (!stamps.received) {
            const recvEv = list.find(e => e.to_status === 'received');
            stamps.received = recvEv ? recvEv.created_at : o.created_at;
          }
          if (stamps.received && stamps.preparing) recv2prep.push(diffMinutes(stamps.received, stamps.preparing));
          if (stamps.preparing && stamps['out-for-delivery']) prep2out.push(diffMinutes(stamps.preparing, stamps['out-for-delivery']));
          if (stamps['out-for-delivery'] && stamps.delivered) out2delivered.push(diffMinutes(stamps['out-for-delivery'], stamps.delivered));
          if (stamps.received && stamps.delivered) totals.push(diffMinutes(stamps.received, stamps.delivered));
        });

        return {
          tenant_id: t.id,
          tenant_name: t.name,
          tenant_slug: t.slug,
          total_orders,
          delivered,
          cancelled,
          cancel_rate: Math.round(cancel_rate * 10) / 10,
          avg_ticket: Math.round(avg_ticket * 100) / 100,
          gross_revenue: Math.round(gross_revenue * 100) / 100,
          platform_fee_total: Math.round(platform_fee_total * 100) / 100,
          auto_advance_count,
          auto_assign_count,
          manual_count,
          automation_rate: Math.round(automation_rate * 10) / 10,
          avg_received_to_preparing_min: avg(recv2prep),
          avg_preparing_to_out_min: avg(prep2out),
          avg_out_to_delivered_min: avg(out2delivered),
          avg_total_min: avg(totals),
        };
      }).sort((a, b) => b.total_orders - a.total_orders);
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
};
