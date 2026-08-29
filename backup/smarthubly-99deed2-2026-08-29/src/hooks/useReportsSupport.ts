import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type OperationalReports = {
  total_orders: number;
  total_revenue: number;
  avg_ticket: number;
  by_hour: Array<{ hour: number; orders: number; revenue: number; avg_ticket: number }>;
  by_dow: Array<{ dow: number; orders: number; revenue: number }>;
  product_mix: Array<{ product_name: string; qty: number; revenue: number }>;
  waiter_performance: Array<{ waiter_id: string; waiter_name: string; orders: number; revenue: number; avg_ticket: number }>;
};

export function useOperationalReports(tenantId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ['op-reports', tenantId, from, to],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_operational_reports', {
        _tenant_id: tenantId!, _from: from, _to: to,
      });
      if (error) throw error;
      return data as unknown as OperationalReports;
    },
  });
}

// ============ Suporte ============
export type SupportTicket = {
  id: string;
  tenant_id: string;
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  category: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_type: 'customer' | 'support';
  sender_name: string | null;
  content: string;
  created_at: string;
};

export function useSupportTickets(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['support-tickets', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('support_tickets').select('*').eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data || []) as SupportTicket[];
    },
  });
}

export function useCreateTicket(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Partial<SupportTicket> & { subject: string; description: string }) => {
      if (!tenantId) throw new Error('no tenant');
      const { data, error } = await (supabase as any)
        .from('support_tickets').insert({ ...t, tenant_id: tenantId }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['support-tickets', tenantId] }); toast.success('Chamado aberto'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useTicketMessages(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['support-messages', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('support_messages').select('*').eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as SupportMessage[];
    },
    refetchInterval: 10000,
  });
}

export function useSendTicketMessage(ticketId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ content, senderName }: { content: string; senderName?: string }) => {
      if (!ticketId) throw new Error('no ticket');
      const { error } = await (supabase as any).from('support_messages').insert({
        ticket_id: ticketId, sender_type: 'customer', sender_name: senderName || null, content,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support-messages', ticketId] }),
  });
}
