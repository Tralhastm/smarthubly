import { useState } from 'react';
import { useTenantInvoices, useDeclarePayment } from '@/hooks/useBilling';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Clock, AlertTriangle, DollarSign, Loader2 } from 'lucide-react';

const STATUS: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'Aguardando pagamento', color: 'text-yellow-400 bg-yellow-400/10', icon: Clock },
  payment_declared: { label: 'Pagamento em análise', color: 'text-blue-400 bg-blue-400/10', icon: DollarSign },
  paid: { label: 'Pago', color: 'text-green-400 bg-green-400/10', icon: CheckCircle2 },
  overdue: { label: 'Atrasada', color: 'text-red-400 bg-red-400/10', icon: AlertTriangle },
  cancelled: { label: 'Cancelada', color: 'text-muted-foreground bg-secondary', icon: Clock },
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

interface Props { tenantId: string; blockedUntil?: string | null }

const TenantBillingPanel = ({ tenantId, blockedUntil }: Props) => {
  const { data: invoices = [], isLoading } = useTenantInvoices(tenantId);
  const declare = useDeclarePayment();
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const submit = async (id: string) => {
    if (!note.trim()) {
      toast({ title: 'Adicione uma observação (ex: comprovante, data)', variant: 'destructive' });
      return;
    }
    try {
      await declare.mutateAsync({ id, note: note.trim() });
      toast({ title: '✅ Pagamento declarado', description: 'Aguardando confirmação do administrador' });
      setOpenId(null);
      setNote('');
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const isBlocked = blockedUntil && new Date(blockedUntil) > new Date();

  return (
    <div className="space-y-4">
      {isBlocked && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          <div className="flex items-center gap-2 text-red-400 font-bold">
            <AlertTriangle className="h-5 w-5" /> Loja bloqueada por inadimplência
          </div>
          <div className="text-sm text-foreground">
            Sua loja não pode receber novos pedidos até regularizar as cobranças em atraso. 
            Bloqueio até {fmtDate(blockedUntil!)}.
          </div>
        </div>
      )}

      <div>
        <h2 className="font-heading text-xl text-foreground">Minhas Cobranças</h2>
        <p className="text-sm text-muted-foreground">Taxa de plataforma sobre seus pedidos</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : invoices.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          Nenhuma cobrança até o momento
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => {
            const s = STATUS[inv.status] || STATUS.pending;
            const Icon = s.icon;
            return (
              <div key={inv.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}
                    </div>
                    <div className="text-sm text-foreground">{inv.orders_count} pedidos no período</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-foreground">{fmt(Number(inv.amount))}</div>
                    <div className="text-xs text-muted-foreground">Vence {fmtDate(inv.due_date)}</div>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${s.color}`}>
                  <Icon className="h-3 w-3" /> {s.label}
                </span>
                {(inv.status === 'pending' || inv.status === 'overdue') && (
                  <>
                    {openId === inv.id ? (
                      <div className="space-y-2 pt-2 border-t border-border">
                        <textarea value={note} onChange={e => setNote(e.target.value)}
                          rows={2} placeholder="Comprovante / data / forma de pagamento"
                          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm resize-none" />
                        <div className="flex gap-2">
                          <button onClick={() => { setOpenId(null); setNote(''); }}
                            className="flex-1 rounded-md bg-secondary text-muted-foreground px-3 py-2 text-xs">
                            Cancelar
                          </button>
                          <button onClick={() => submit(inv.id)} disabled={declare.isPending}
                            className="flex-1 rounded-md gradient-primary text-primary-foreground px-3 py-2 text-xs font-medium disabled:opacity-50">
                            {declare.isPending ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : 'Confirmar declaração'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setOpenId(inv.id)}
                        className="w-full rounded-md bg-blue-500/20 text-blue-400 px-3 py-2 text-xs font-medium hover:bg-blue-500/30">
                        Declarar pagamento
                      </button>
                    )}
                  </>
                )}
                {inv.payment_note && (
                  <div className="text-xs text-muted-foreground rounded-md bg-secondary p-2">
                    💬 {inv.payment_note}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TenantBillingPanel;
