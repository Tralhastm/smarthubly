import { useState, useMemo } from 'react';
import {
  useCreditAccounts, useAddCreditAccount, useUpdateCreditAccount, useDeleteCreditAccount,
  useAddCreditPayment, useSendCreditReminder, computeRisk, findCustomerHistory,
  type CreditAccount,
} from '@/hooks/useCredit';
import {
  Plus, Trash2, Mail, Loader2, AlertTriangle, CheckCircle2, Clock,
  XCircle, DollarSign, Phone, User, X, Send, ShieldAlert, ShieldCheck,
  Shield, ShieldX,
} from 'lucide-react';
import { toast } from 'sonner';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');
const daysBetween = (a: string, b: string) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  open:      { label: 'Em aberto', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: Clock },
  paid:      { label: 'Pago',      color: 'text-green-400 bg-green-400/10 border-green-400/30', icon: CheckCircle2 },
  overdue:   { label: 'Atrasado',  color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', icon: AlertTriangle },
  defaulted: { label: 'CALOTE',    color: 'text-red-400 bg-red-400/10 border-red-400/30', icon: XCircle },
};

const RISK_META: Record<string, { label: string; color: string; icon: any }> = {
  novo:    { label: 'Novo cliente',    color: 'text-blue-400 bg-blue-400/10', icon: Shield },
  bom:     { label: 'Bom pagador',     color: 'text-green-400 bg-green-400/10', icon: ShieldCheck },
  atencao: { label: 'Atenção',         color: 'text-yellow-400 bg-yellow-400/10', icon: Shield },
  ruim:    { label: 'Risco alto',      color: 'text-orange-400 bg-orange-400/10', icon: ShieldAlert },
  calote:  { label: 'MAL PAGADOR',     color: 'text-red-400 bg-red-400/10 animate-pulse', icon: ShieldX },
};

const FiadoTab = ({ tenantId }: { tenantId: string }) => {
  const { data: accounts = [], isLoading } = useCreditAccounts(tenantId);
  const addAcc = useAddCreditAccount();
  const updateAcc = useUpdateCreditAccount();
  const delAcc = useDeleteCreditAccount();
  const addPay = useAddCreditPayment();
  const sendReminder = useSendCreditReminder();

  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<string>('active');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [reminderId, setReminderId] = useState<string | null>(null);
  const [reminderTestMode, setReminderTestMode] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  

  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_email: '',
    amount: '', description: '', due_date: '', notes: '',
  });

  const customerRisk = useMemo(() => {
    if (!form.customer_phone && !form.customer_email) return null;
    const hist = findCustomerHistory(accounts, form.customer_phone, form.customer_email);
    if (hist.length === 0) return null;
    return { risk: computeRisk(hist), history: hist };
  }, [form.customer_phone, form.customer_email, accounts]);

  // Agrupa por cliente para histórico
  const customerGroups = useMemo(() => {
    const map = new Map<string, CreditAccount[]>();
    accounts.forEach(a => {
      const key = (a.customer_phone || a.customer_email || a.customer_name).toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [accounts]);

  const totals = useMemo(() => {
    const open = accounts.filter(a => a.status === 'open');
    const overdue = accounts.filter(a => a.status === 'overdue');
    const defaulted = accounts.filter(a => a.status === 'defaulted');
    const remaining = (a: CreditAccount) => Number(a.amount) - Number(a.amount_paid);
    return {
      openCount: open.length,
      openSum: open.reduce((s, a) => s + remaining(a), 0),
      overdueCount: overdue.length,
      overdueSum: overdue.reduce((s, a) => s + remaining(a), 0),
      defaultedCount: defaulted.length,
      defaultedSum: defaulted.reduce((s, a) => s + remaining(a), 0),
      paidSum: accounts.filter(a => a.status === 'paid').reduce((s, a) => s + Number(a.amount), 0),
    };
  }, [accounts]);

  const filtered = useMemo(() => {
    if (filter === 'all') return accounts;
    if (filter === 'active') return accounts.filter(a => a.status === 'open' || a.status === 'overdue');
    return accounts.filter(a => a.status === filter);
  }, [accounts, filter]);

  const resetForm = () => {
    setForm({ customer_name: '', customer_phone: '', customer_email: '', amount: '', description: '', due_date: '', notes: '' });
    setShowAdd(false);
  };

  const handleAdd = async () => {
    if (!form.customer_name.trim()) return toast.error('Nome do cliente obrigatório');
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Valor inválido');
    if (!form.due_date) return toast.error('Data de vencimento obrigatória');

    if (customerRisk?.risk.label === 'calote') {
      if (!confirm(`⚠️ ATENÇÃO!\n\nEste cliente tem ${customerRisk.history.filter(h => h.status === 'defaulted').length} CALOTE(S) registrado(s).\n\nTem CERTEZA que quer dar fiado novamente?`)) return;
    } else if (customerRisk?.risk.label === 'ruim') {
      if (!confirm(`⚠️ Cliente de risco alto.\n\n${customerRisk.risk.reason}\n\nDeseja continuar mesmo assim?`)) return;
    }

    try {
      await addAcc.mutateAsync({
        tenant_id: tenantId,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        customer_email: form.customer_email.trim(),
        amount: Number(form.amount),
        description: form.description.trim(),
        due_date: new Date(form.due_date + 'T23:59:59').toISOString(),
        notes: form.notes.trim(),
      });
      toast.success('✅ Fiado registrado');
      resetForm();
    } catch (e: any) {
      toast.error('Erro: ' + e.message);
    }
  };

  const handlePay = async (acc: CreditAccount) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return toast.error('Valor inválido');
    const remaining = Number(acc.amount) - Number(acc.amount_paid);
    if (amount > remaining + 0.01) return toast.error(`Valor maior que devido (${fmt(remaining)})`);
    try {
      await addPay.mutateAsync({
        accountId: acc.id, tenantId, amount, note: '',
        currentPaid: Number(acc.amount_paid), totalAmount: Number(acc.amount),
      });
      toast.success(amount >= remaining ? '🎉 Fiado quitado!' : `Pagamento de ${fmt(amount)} registrado`);
      setPayingId(null);
      setPayAmount('');
    } catch (e: any) { toast.error('Erro: ' + e.message); }
  };

  const handleMarkDefault = async (acc: CreditAccount) => {
    if (!confirm(`Marcar como CALOTE?\n\nIsto sinalizará ${acc.customer_name} como mal pagador permanentemente.`)) return;
    try {
      await updateAcc.mutateAsync({ id: acc.id, status: 'defaulted' });
      toast.success('Marcado como calote');
    } catch (e: any) { toast.error('Erro: ' + e.message); }
  };

  const handleSendReminder = async (acc: CreditAccount) => {
    const useTest = reminderTestMode && testEmail.trim();
    if (!useTest && !acc.customer_email) {
      return toast.error('Cliente sem e-mail. Use modo teste ou cadastre o e-mail.');
    }
    setReminderId(acc.id);
    try {
      const r: any = await sendReminder.mutateAsync({
        accountId: acc.id,
        testEmail: useTest ? testEmail.trim() : undefined,
      });
      toast.success(`📧 E-mail enviado para ${r?.to || 'cliente'}`);
    } catch (e: any) {
      toast.error('Erro: ' + e.message);
    } finally {
      setReminderId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Em aberto</div>
          <div className="text-lg font-bold text-yellow-400">{fmt(totals.openSum)}</div>
          <div className="text-xs text-muted-foreground">{totals.openCount} fiado(s)</div>
        </div>
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
          <div className="text-xs text-muted-foreground">⚠️ Atrasado</div>
          <div className="text-lg font-bold text-orange-400">{fmt(totals.overdueSum)}</div>
          <div className="text-xs text-muted-foreground">{totals.overdueCount} fiado(s)</div>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
          <div className="text-xs text-muted-foreground">🚨 Calote</div>
          <div className="text-lg font-bold text-red-400">{fmt(totals.defaultedSum)}</div>
          <div className="text-xs text-muted-foreground">{totals.defaultedCount} confirmado(s)</div>
        </div>
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3">
          <div className="text-xs text-muted-foreground">✅ Recebido</div>
          <div className="text-lg font-bold text-green-400">{fmt(totals.paidSum)}</div>
          <div className="text-xs text-muted-foreground">total quitado</div>
        </div>
      </div>

      {/* Modo teste de e-mail */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={reminderTestMode}
            onChange={(e) => setReminderTestMode(e.target.checked)} className="accent-primary" />
          <Mail className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground">Modo teste de e-mail</span>
        </label>
        {reminderTestMode && (
          <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
            placeholder="seu-email@teste.com (cobranças irão para este e-mail)"
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
        )}
        <p className="text-xs text-muted-foreground">
          Quando ativado, todos os e-mails de cobrança vão para o endereço acima em vez do cliente real.
        </p>
      </div>

      {/* Botão adicionar */}
      <button onClick={() => setShowAdd(true)}
        className="flex items-center gap-2 w-full justify-center rounded-lg gradient-primary text-primary-foreground px-4 py-2.5 font-medium hover:opacity-90">
        <Plus className="h-4 w-4" /> Registrar novo fiado
      </button>

      {/* Filtros */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { id: 'active', label: 'Ativos' },
          { id: 'overdue', label: 'Atrasados' },
          { id: 'defaulted', label: 'Calotes' },
          { id: 'paid', label: 'Pagos' },
          { id: 'all', label: 'Todos' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${filter === f.id ? 'gradient-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          Nenhum fiado nesta categoria
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(acc => {
            const s = STATUS_META[acc.status] || STATUS_META.open;
            const Icon = s.icon;
            const remaining = Number(acc.amount) - Number(acc.amount_paid);
            const overdueDays = acc.status === 'overdue' || acc.status === 'defaulted'
              ? daysBetween(acc.due_date, new Date().toISOString()) : 0;
            const customerKey = (acc.customer_phone || acc.customer_email || acc.customer_name).toLowerCase();
            const allOfCustomer = customerGroups.get(customerKey) || [acc];
            const risk = computeRisk(allOfCustomer.filter(h => h.id !== acc.id));

            return (
              <div key={acc.id} className={`rounded-xl border-2 ${s.color.split(' ')[2]} bg-card p-3 space-y-2`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-foreground truncate">{acc.customer_name}</span>
                      {risk.label !== 'novo' && risk.label !== 'bom' && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${RISK_META[risk.label].color}`}>
                          {RISK_META[risk.label].label}
                        </span>
                      )}
                    </div>
                    {acc.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{acc.description}</div>}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                      {acc.customer_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{acc.customer_phone}</span>}
                      {acc.customer_email && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{acc.customer_email}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-base font-bold ${s.color.split(' ')[0]}`}>{fmt(remaining)}</div>
                    {Number(acc.amount_paid) > 0 && (
                      <div className="text-[10px] text-muted-foreground">de {fmt(Number(acc.amount))}</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${s.color}`}>
                    <Icon className="h-3 w-3" /> {s.label}
                    {overdueDays > 0 && ` · ${overdueDays}d`}
                  </span>
                  <span className="text-xs text-muted-foreground">Vence {fmtDate(acc.due_date)}</span>
                </div>

                {acc.reminders_sent > 0 && (
                  <div className="text-xs text-muted-foreground bg-secondary/50 rounded p-1.5">
                    📧 {acc.reminders_sent} cobrança(s) enviada(s)
                    {acc.last_reminder_at && ` · última em ${fmtDate(acc.last_reminder_at)}`}
                  </div>
                )}

                {payingId === acc.id ? (
                  <div className="flex gap-2 pt-1">
                    <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                      placeholder={`Restam ${fmt(remaining)}`}
                      className="flex-1 rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-foreground" />
                    <button onClick={() => setPayAmount(String(remaining))}
                      className="rounded-md bg-secondary px-2 text-xs text-muted-foreground hover:bg-secondary/70">
                      Tudo
                    </button>
                    <button onClick={() => handlePay(acc)} disabled={addPay.isPending}
                      className="rounded-md bg-green-500/20 text-green-400 px-3 text-xs font-medium hover:bg-green-500/30">
                      Confirmar
                    </button>
                    <button onClick={() => { setPayingId(null); setPayAmount(''); }}
                      className="rounded-md bg-secondary px-2 text-muted-foreground"><X className="h-4 w-4" /></button>
                  </div>
                ) : acc.status !== 'paid' && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    <button onClick={() => { setPayingId(acc.id); setPayAmount(String(remaining)); }}
                      className="flex-1 flex items-center justify-center gap-1 rounded-md bg-green-500/20 text-green-400 px-2 py-1.5 text-xs font-medium hover:bg-green-500/30">
                      <DollarSign className="h-3 w-3" /> Receber
                    </button>
                    <button onClick={() => handleSendReminder(acc)} disabled={reminderId === acc.id}
                      className="flex-1 flex items-center justify-center gap-1 rounded-md bg-blue-500/20 text-blue-400 px-2 py-1.5 text-xs font-medium hover:bg-blue-500/30 disabled:opacity-50">
                      {reminderId === acc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Cobrar
                    </button>
                    {acc.status !== 'defaulted' && (
                      <button onClick={() => handleMarkDefault(acc)}
                        className="flex items-center justify-center gap-1 rounded-md bg-red-500/20 text-red-400 px-2 py-1.5 text-xs font-medium hover:bg-red-500/30">
                        <ShieldX className="h-3 w-3" /> Calote
                      </button>
                    )}
                    <button onClick={() => { if (confirm('Excluir este registro?')) delAcc.mutate(acc.id); }}
                      className="rounded-md bg-red-500/10 text-red-400 px-2 py-1.5 hover:bg-red-500/20">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Adicionar */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4" onClick={resetForm}>
          <div className="w-full md:max-w-md bg-card rounded-t-2xl md:rounded-2xl border border-border max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
              <h3 className="font-bold text-foreground">Novo fiado</h3>
              <button onClick={resetForm}><X className="h-5 w-5 text-muted-foreground" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><User className="h-3 w-3" />Nome do cliente *</label>
                <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" placeholder="Ex: João Silva" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Phone className="h-3 w-3" />Telefone</label>
                  <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" placeholder="(11) 9..." />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Mail className="h-3 w-3" />E-mail</label>
                  <input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" placeholder="cliente@..." />
                </div>
              </div>

              {/* Alerta de risco */}
              {customerRisk && customerRisk.risk.label !== 'novo' && (
                <div className={`rounded-lg p-3 border-2 ${
                  customerRisk.risk.label === 'calote' ? 'bg-red-500/10 border-red-500/40' :
                  customerRisk.risk.label === 'ruim' ? 'bg-orange-500/10 border-orange-500/40' :
                  customerRisk.risk.label === 'atencao' ? 'bg-yellow-500/10 border-yellow-500/40' :
                  'bg-green-500/10 border-green-500/40'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    {(() => { const Icon = RISK_META[customerRisk.risk.label].icon; return <Icon className="h-4 w-4" />; })()}
                    <span className="font-bold text-sm text-foreground">{RISK_META[customerRisk.risk.label].label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{customerRisk.risk.reason}</p>
                  <p className="text-xs text-muted-foreground mt-1">Histórico: {customerRisk.history.length} compra(s)</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Valor (R$) *</label>
                  <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" placeholder="0,00" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Vencimento *</label>
                  <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Descrição</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" placeholder="Ex: 2 X-Burger + Coca" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notas internas</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" placeholder="Observações..." />
              </div>
              <button onClick={handleAdd} disabled={addAcc.isPending}
                className="w-full rounded-lg gradient-primary text-primary-foreground py-2.5 font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {addAcc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Registrar fiado
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiadoTab;
