import { supabase } from '@/integrations/supabase/client';

export type OrderActor = 'system' | 'customer' | 'admin' | 'supplier' | 'driver';
export type OrderEventType =
  | 'status_change'
  | 'auto_assign_supplier'
  | 'auto_advance'
  | 'note'
  | 'created'
  | 'lalamove_dispatched'
  | 'lalamove_dispatched_by_supplier'
  | 'lalamove_cancelled_by_supplier'
  | 'driver_assigned_by_supplier';

interface LogParams {
  order_id: string;
  tenant_id: string;
  event_type: OrderEventType;
  from_status?: string | null;
  to_status?: string | null;
  actor?: OrderActor;
  actor_id?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}

export const logOrderEvent = async (params: LogParams) => {
  try {
    // Anonymous customers can only register the "created" event via a restricted RPC
    if (params.actor === 'customer' && params.event_type === 'created') {
      await (supabase as any).rpc('log_order_created_event', {
        _order_id: params.order_id,
        _description: params.description,
        _metadata: params.metadata ?? {},
      });
      return;
    }

    await (supabase as any).from('order_events').insert({
      order_id: params.order_id,
      tenant_id: params.tenant_id,
      event_type: params.event_type,
      from_status: params.from_status ?? null,
      to_status: params.to_status ?? null,
      actor: params.actor ?? 'system',
      actor_id: params.actor_id ?? null,
      description: params.description,
      metadata: params.metadata ?? {},
    });
  } catch (e) {
    console.error('Failed to log order event:', e);
  }
};
