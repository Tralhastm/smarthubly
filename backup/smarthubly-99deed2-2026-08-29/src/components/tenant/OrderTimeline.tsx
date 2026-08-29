import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Clock, User, Bot, Truck, Package, ShoppingBag } from 'lucide-react';

interface OrderEvent {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  description: string;
  created_at: string;
}

const actorIcons: Record<string, React.ReactNode> = {
  system: <Bot className="h-3.5 w-3.5 text-blue-400" />,
  customer: <ShoppingBag className="h-3.5 w-3.5 text-purple-400" />,
  admin: <User className="h-3.5 w-3.5 text-primary" />,
  supplier: <Package className="h-3.5 w-3.5 text-yellow-400" />,
  driver: <Truck className="h-3.5 w-3.5 text-orange-400" />,
};

const OrderTimeline = ({ orderId }: { orderId: string }) => {
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await (supabase as any).from('order_events')
        .select('*').eq('order_id', orderId).order('created_at', { ascending: true });
      if (active) { setEvents((data as OrderEvent[]) || []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [orderId]);

  if (loading) return <p className="text-xs text-muted-foreground">Carregando linha do tempo...</p>;
  if (events.length === 0) return <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>;

  return (
    <div className="space-y-2 border-l-2 border-border pl-3 ml-1">
      {events.map(ev => (
        <div key={ev.id} className="relative">
          <div className="absolute -left-[18px] top-0.5 rounded-full bg-card p-0.5 border border-border">
            {actorIcons[ev.actor] || <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
          <p className="text-xs text-foreground leading-tight">{ev.description}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(ev.created_at).toLocaleString('pt-BR')}
            {ev.from_status && ev.to_status && ` · ${ev.from_status} → ${ev.to_status}`}
          </p>
        </div>
      ))}
    </div>
  );
};

export default OrderTimeline;
