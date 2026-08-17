import { useState } from 'react';
import { useAllInvoices, useApprovePayment, useGenerateInvoices } from '@/hooks/useBilling';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Clock, AlertTriangle, RefreshCw, DollarSign, Loader2, Mail } from 'lucide-react';

const STATUS_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'Aguardando', color: 'text-yellow-400 bg-yellow-400/10', icon: Clock },
  payment_declared: { label: 'Pagamento declarado', color: 'text-blue-400 bg-blue-400/10', icon: DollarSign },
  paid: { label: 'Pago', color: 'text-green-400 bg-green-400/10', icon: CheckCircle2 },
  overdue: { label: 'Atrasada', color: 'text-red-400 bg-red-400/10', icon: AlertTriangle },
  cancelled: { label: 'Cancelada', color: 'text-muted-foreground bg-secondary', icon: Clock },
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

const SuperAdminBilling = () => {
  const { data: invoices = [], isLoading } = useAllInvoices();
  const generate = useGenerateInvoices();
  const approve = useApprovePayment();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>('all');
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const sendTestEmail = async () => {
    if (!testEmail.trim()) {
      toast({ title: 'Digite um e-mail para teste', variant: 'destructive' });
      return;
    }
    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-billing-email', {
        body: { test_email: testEmail.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: '✅ E-mail de teste enviado!', description: `Verifique a caixa de entrada de ${testEmail}` });
    } catch (e: any) {
      toast({ title: 'Erro ao enviar', description: e.message, variant: 'destructive' });
    } finally {
      setSendingTest(false);
    }
  };

  const sendInvoiceEmail = async (id: string) => {
    setSendingId(id);
    try {
      const { data, error } = await supabase.functions.invoke('send-billing-email', {
        body: { invoice_id: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: '✅ E-mail enviado', description: `Para: ${(data as any)?.to}` });
    } catch (e: any) {
      toast({ title: 'Erro ao enviar', description: e.message, variant: 'destructive' });
    } finally {
      setSendingId(null);
    }
  };

  const handleGenerate = async () => {
    try {
      const r = await generate.mutateAsync({ force: false });
      toast({ title: `${(r as any)?.generated || 0} cobranças geradas`, description: `${(r as any)?.overdue || 0} atrasadas` });
    } catch (e: any) {
      toast({ title: 'Erro ao gerar', description: e.message, variant: 'destructive' });
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('Confirmar pagamento desta cobrança?')) return;
    try {
      await approve.mutateAsync({ id });
      toast({ title: '✅ Pagamento confirmado' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter);
  const totals = {
    pending: invoices.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.amount), 0),
    declared: invoices.filter(i => i.status === 'payment_declared').reduce((s, i) => s + Number(i.amount), 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0),
    overdue: invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + Number(i.amount), 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl text-foreground">Cobranças</h2>
          <p className="text-sm text-muted-foreground">Faturas de taxa de plataforma por loja</p>
        </div>
        <button onClick={handleGenerate} disabled={generate.isPending}
          className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Gerar cobranças do período
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Testar envio de e-mail de cobrança</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Envia um e-mail de exemplo (com dados fictícios) para o endereço informado, para validar o sistema.
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="seu-email@exemplo.com"
            className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-foreground text-sm"
          />
          <button
            onClick={sendTestEmail}
            disabled={sendingTest}
            className="flex items-center gap-2 rounded-lg gradient-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Enviar teste
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Aguardando</div>
          <div className="text-xl font-bold text-yellow-400">{fmt(totals.pending)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Declaradas</div>
          <div className="text-xl font-bold text-blue-400">{fmt(totals.declared)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Pagas</div>
          <div className="text-xl font-bold text-green-400">{fmt(totals.paid)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Atrasadas</div>
          <div className="text-xl font-bold text-red-400">{fmt(totals.overdue)}</div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {['all', 'pending', 'payment_declared', 'overdue', 'paid'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              filter === s ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
            }`}>
            {s === 'all' ? 'Todas' : STATUS_LABELS[s]?.label || s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">Nenhuma cobrança</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(inv => {
            const s = STATUS_LABELS[inv.status] || STATUS_LABELS.pending;
            const Icon = s.icon;
            return (
              <div key={inv.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-foreground">{inv.tenants?.name || '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(inv.period_start)} → {fmtDate(inv.period_end)} · {inv.orders_count} pedidos
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-foreground">{fmt(Number(inv.amount))}</div>
                    <div className="text-xs text-muted-foreground">Vence {fmtDate(inv.due_date)}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${s.color}`}>
                    <Icon className="h-3 w-3" /> {s.label}
                  </span>
                  <div className="flex gap-2">
                    {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                      <button onClick={() => sendInvoiceEmail(inv.id)} disabled={sendingId === inv.id}
                        className="flex items-center gap-1 rounded-md bg-blue-500/20 text-blue-400 px-3 py-1 text-xs font-medium hover:bg-blue-500/30 disabled:opacity-50">
                        {sendingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                        Enviar e-mail
                      </button>
                    )}
                    {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                      <button onClick={() => handleApprove(inv.id)} disabled={approve.isPending}
                        className="rounded-md bg-green-500/20 text-green-400 px-3 py-1 text-xs font-medium hover:bg-green-500/30 disabled:opacity-50">
                        Confirmar pago
                      </button>
                    )}
                  </div>
                </div>
                {inv.payment_note && (
                  <div className="text-xs text-muted-foreground rounded-md bg-secondary p-2">
                    💬 Lojista: {inv.payment_note}
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

export default SuperAdminBilling;
