// Painel de chamados de suporte no Super Admin: lista todos os tenants, responde e muda status.
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenants } from '@/hooks/useTenants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LifeBuoy, Send, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTicketMessages } from '@/hooks/useReportsSupport';

type Ticket = {
  id: string; tenant_id: string; subject: string; description: string;
  priority: string; status: string; category: string | null;
  contact_email: string | null; contact_phone: string | null;
  created_at: string; resolved_at: string | null;
};

const priorityColor: Record<string, string> = {
  urgent: 'bg-destructive text-destructive-foreground',
  high: 'bg-orange-500 text-white',
  normal: 'bg-primary text-primary-foreground',
  low: 'bg-secondary text-muted-foreground',
};
const statusLabel: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em andamento', waiting_customer: 'Aguardando cliente',
  resolved: 'Resolvido', closed: 'Fechado',
};

export default function SuperAdminSupport() {
  const qc = useQueryClient();
  const { data: tenants = [] } = useTenants();
  const tenantMap = useMemo(() => Object.fromEntries(tenants.map(t => [t.id, t.name])), [tenants]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [active, setActive] = useState<Ticket | null>(null);

  const { data: tickets = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['sa-support-tickets', statusFilter],
    queryFn: async () => {
      let q = (supabase as any).from('support_tickets').select('*').order('created_at', { ascending: false }).limit(500);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Ticket[];
    },
    refetchInterval: 15000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === 'resolved' || status === 'closed') patch.resolved_at = new Date().toISOString();
      const { error } = await (supabase as any).from('support_tickets').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-support-tickets'] }); toast.success('Status atualizado'); },
    onError: (e: any) => toast.error(e.message),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tickets.length, open: 0, in_progress: 0, waiting_customer: 0, resolved: 0, closed: 0 };
    tickets.forEach(t => { c[t.status] = (c[t.status] || 0) + 1; });
    return c;
  }, [tickets]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-lg text-foreground">Chamados de Suporte</h2>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos ({counts.all})</SelectItem>
              <SelectItem value="open">Abertos ({counts.open || 0})</SelectItem>
              <SelectItem value="in_progress">Em andamento ({counts.in_progress || 0})</SelectItem>
              <SelectItem value="waiting_customer">Aguardando ({counts.waiting_customer || 0})</SelectItem>
              <SelectItem value="resolved">Resolvidos ({counts.resolved || 0})</SelectItem>
              <SelectItem value="closed">Fechados ({counts.closed || 0})</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : tickets.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum chamado.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => (
            <Card key={t.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => setActive(t)}>
              <CardContent className="p-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground truncate">{t.subject}</span>
                    <Badge className={priorityColor[t.priority] || ''}>{t.priority}</Badge>
                    <Badge variant="outline">{statusLabel[t.status] || t.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    🏪 {tenantMap[t.tenant_id] || t.tenant_id.slice(0, 8)} · {new Date(t.created_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {active.subject}
                  <Badge className={priorityColor[active.priority] || ''}>{active.priority}</Badge>
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  🏪 {tenantMap[active.tenant_id] || active.tenant_id} · {new Date(active.created_at).toLocaleString('pt-BR')}
                </p>
              </DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg bg-secondary p-3 text-sm whitespace-pre-wrap">{active.description}</div>
                {(active.contact_email || active.contact_phone) && (
                  <div className="text-xs text-muted-foreground">
                    {active.contact_email && <>📧 {active.contact_email}{' '}</>}
                    {active.contact_phone && <>📱 {active.contact_phone}</>}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  <Select value={active.status} onValueChange={(s) => updateStatus.mutate({ id: active.id, status: s })}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <SupportThread ticketId={active.id} tenantId={active.tenant_id} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SupportThread({ ticketId, tenantId }: { ticketId: string; tenantId: string }) {
  const qc = useQueryClient();
  const { data: msgs = [] } = useTicketMessages(ticketId);
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: async () => {
      if (!text.trim()) return;
      const { error } = await (supabase as any).from('support_messages').insert({
        ticket_id: ticketId, sender_type: 'support', sender_name: 'Suporte', content: text.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['support-messages', ticketId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-foreground">Conversa</h4>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {msgs.length === 0 && <p className="text-xs text-muted-foreground">Sem mensagens ainda.</p>}
        {msgs.map(m => (
          <div key={m.id} className={`rounded-lg p-2 text-sm ${m.sender_type === 'support' ? 'bg-primary/10 ml-8' : 'bg-secondary mr-8'}`}>
            <p className="text-xs text-muted-foreground mb-1">
              {m.sender_type === 'support' ? '🛟 Suporte' : '👤 Cliente'} {m.sender_name && `· ${m.sender_name}`} · {new Date(m.created_at).toLocaleString('pt-BR')}
            </p>
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="Responder ao cliente..." rows={2} />
        <Button onClick={() => send.mutate()} disabled={!text.trim() || send.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
