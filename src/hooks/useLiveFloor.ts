// Hook do Salão ao Vivo: mesas + sessões + somatória em tempo real.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect } from 'react';

export interface LiveSession {
  id: string;
  status: string;
  customer_name: string;
  total: number;
  opened_at: string;
  sent_at: string | null;
  assigned_waiter_name: string | null;
  minutes_open: number;
  paid_partial: number;
  balance: number;
  items_count: number;
}

export interface LiveTable {
  table_id: string;
  label: string;
  seats: number | null;
  active: boolean;
  session: LiveSession | null;
}

export interface LiveFloor {
  tables: LiveTable[];
  total_open: number;
  count_open: number;
  generated_at: string;
}

export const useLiveFloor = (tenantId?: string) => {
  const qc = useQueryClient();

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`live-floor-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions', filter: `tenant_id=eq.${tenantId}` }, () => qc.invalidateQueries({ queryKey: ['live-floor', tenantId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_session_items', filter: `tenant_id=eq.${tenantId}` }, () => qc.invalidateQueries({ queryKey: ['live-floor', tenantId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_session_payments', filter: `tenant_id=eq.${tenantId}` }, () => qc.invalidateQueries({ queryKey: ['live-floor', tenantId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables', filter: `tenant_id=eq.${tenantId}` }, () => qc.invalidateQueries({ queryKey: ['live-floor', tenantId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, qc]);

  return useQuery({
    queryKey: ['live-floor', tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_live_floor', { _tenant_id: tenantId });
      if (error) throw error;
      return data as LiveFloor;
    },
    enabled: !!tenantId,
    refetchInterval: 15000,
  });
};

export const useSessionPayments = (sessionId?: string) => {
  return useQuery({
    queryKey: ['session-payments', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data } = await (supabase as any)
        .from('table_session_payments')
        .select('*')
        .eq('session_id', sessionId)
        .order('paid_at', { ascending: false });
      return data || [];
    },
    enabled: !!sessionId,
  });
};

export const useAddPartialPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { session_id: string; tenant_id: string; amount: number; method: string; payer_name?: string; operator_name?: string; tab_label?: string }) => {
      const { error } = await (supabase as any).from('table_session_payments').insert(input);
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['session-payments', v.session_id] });
      qc.invalidateQueries({ queryKey: ['live-floor', v.tenant_id] });
      toast.success('Pagamento registrado');
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao registrar pagamento'),
  });
};

export const useTransferTable = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, newTableId, tenantId }: { sessionId: string; newTableId: string; tenantId: string }) => {
      const { error } = await (supabase as any).rpc('transfer_table_session', { _session_id: sessionId, _new_table_id: newTableId });
      if (error) throw error;
      return tenantId;
    },
    onSuccess: (tenantId) => {
      qc.invalidateQueries({ queryKey: ['live-floor', tenantId] });
      toast.success('Comanda transferida');
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao transferir'),
  });
};

export const useMergeTables = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sourceId, targetId, tenantId }: { sourceId: string; targetId: string; tenantId: string }) => {
      const { error } = await (supabase as any).rpc('merge_table_sessions', { _source_id: sourceId, _target_id: targetId });
      if (error) throw error;
      return tenantId;
    },
    onSuccess: (tenantId) => {
      qc.invalidateQueries({ queryKey: ['live-floor', tenantId] });
      toast.success('Comandas juntadas');
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao juntar comandas'),
  });
};

export const useToggleProduct86 = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, inStock, tenantId: _t }: { productId: string; inStock: boolean; tenantId: string }) => {
      const { error } = await (supabase as any).rpc('toggle_product_86', { _product_id: productId, _in_stock: inStock });
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['products', v.tenantId] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(v.inStock ? 'Produto reativado' : 'Marcado como "86" (esgotado)');
    },
    onError: (e: any) => toast.error(e.message || 'Erro'),
  });
};
