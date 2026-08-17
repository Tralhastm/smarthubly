// Salão ao Vivo — mapa de mesas em tempo real com somatória, status, split e transferência.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, Clock, DollarSign, Receipt, ArrowRightLeft, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useLiveFloor, LiveTable } from '@/hooks/useLiveFloor';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import TableSplitPaymentDialog from './TableSplitPaymentDialog';
import TableTransferMergeDialog from './TableTransferMergeDialog';

interface Props { tenantId: string; }

const statusColor = (s: string | undefined, minutes: number) => {
  if (!s) return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300';
  if (s === 'sent') return 'bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300';
  if (minutes > 90) return 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300';
  if (minutes > 45) return 'bg-orange-500/10 border-orange-500/40 text-orange-700 dark:text-orange-300';
  return 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300';
};

export default function TenantLiveFloor({ tenantId }: Props) {
  const { data, isLoading, refetch } = useLiveFloor(tenantId);
  const [splitFor, setSplitFor] = useState<LiveTable | null>(null);
  const [moveFor, setMoveFor] = useState<LiveTable | null>(null);

  const closeSession = async (sessionId: string, total: number, paid: number) => {
    if (paid < total - 0.01) {
      if (!confirm(`Falta R$ ${(total - paid).toFixed(2)} para pagar. Fechar mesmo assim?`)) return;
    }
    const { error } = await (supabase as any).from('table_sessions').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', sessionId);
    if (error) return toast.error(error.message);
    toast.success('Comanda encerrada');
    refetch();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" />Salão ao Vivo</CardTitle>
            <CardDescription>Mapa de mesas em tempo real com somatória de caixa previsto.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Mesas ocupadas</div>
            <div className="text-2xl font-bold">{data?.count_open || 0}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Mesas livres</div>
            <div className="text-2xl font-bold">{(data?.tables.filter(t => !t.session).length) || 0}</div>
          </div>
          <div className="rounded-lg border p-3 col-span-2">
            <div className="text-xs text-muted-foreground">Somatória se todas pagarem agora</div>
            <div className="text-2xl font-bold text-green-600">R$ {Number(data?.total_open || 0).toFixed(2)}</div>
          </div>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground text-center py-8">Carregando salão…</p>
        : (data?.tables.length || 0) === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mesa cadastrada. Crie em "Mesas".</p>
        : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {data!.tables.map(t => {
              const s = t.session;
              const minutes = s ? Math.floor(s.minutes_open) : 0;
              return (
                <div key={t.table_id} className={`rounded-lg border-2 p-3 transition-all ${statusColor(s?.status, minutes)}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-bold text-lg leading-none">{t.label}</div>
                      {t.seats && <div className="text-xs opacity-70">{t.seats} lugares</div>}
                    </div>
                    {!s ? <Badge variant="outline" className="text-xs">Livre</Badge>
                      : <Badge variant="secondary" className="text-xs">{s.status === 'sent' ? 'Enviada' : 'Aberta'}</Badge>}
                  </div>
                  {s && (
                    <div className="space-y-2">
                      {s.customer_name && <div className="text-xs truncate">👤 {s.customer_name}</div>}
                      {s.assigned_waiter_name && <div className="text-xs truncate">🧑‍🍳 {s.assigned_waiter_name}</div>}
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{minutes}min</span>
                        <span>{s.items_count} itens</span>
                      </div>
                      <div className="rounded bg-background/60 dark:bg-background/40 p-2 space-y-0.5">
                        <div className="flex justify-between text-xs"><span>Total</span><span className="font-semibold">R$ {Number(s.total).toFixed(2)}</span></div>
                        {Number(s.paid_partial) > 0 && (
                          <>
                            <div className="flex justify-between text-xs text-green-600"><span>Pago</span><span>R$ {Number(s.paid_partial).toFixed(2)}</span></div>
                            <div className="flex justify-between text-xs text-orange-600 font-semibold"><span>Falta</span><span>R$ {Number(s.balance).toFixed(2)}</span></div>
                          </>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <Button size="sm" variant="outline" className="text-xs px-1 h-8" onClick={() => setSplitFor(t)} title="Pagar / dividir">
                          <Receipt className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs px-1 h-8" onClick={() => setMoveFor(t)} title="Transferir / juntar">
                          <ArrowRightLeft className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="default" className="text-xs px-1 h-8" onClick={() => closeSession(s.id, Number(s.total), Number(s.paid_partial))} title="Encerrar">
                          <CheckCircle2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {splitFor?.session && (
        <TableSplitPaymentDialog
          open={!!splitFor}
          onOpenChange={(v) => !v && setSplitFor(null)}
          sessionId={splitFor.session.id}
          tenantId={tenantId}
          total={Number(splitFor.session.total)}
        />
      )}
      {moveFor?.session && data && (
        <TableTransferMergeDialog
          open={!!moveFor}
          onOpenChange={(v) => !v && setMoveFor(null)}
          sessionId={moveFor.session.id}
          currentTableId={moveFor.table_id}
          tenantId={tenantId}
          allTables={data.tables}
        />
      )}
    </Card>
  );
}
