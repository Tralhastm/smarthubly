import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { WEEKDAY_LABELS } from '@/lib/scheduling';
import { useAppointments, useUpdateAppointment, useCreateAppointment } from '@/hooks/useAppointments';
import WeekCalendarView from './WeekCalendarView';
import { Calendar, Clock, CheckCircle2, AlarmClock, X, Save, Settings, List, CalendarDays, Plus, CalendarClock } from 'lucide-react';

interface ServiceOption {
  id: string;
  name: string;
  duration_minutes: number | null;
  price: number;
}

interface Props {
  tenantId: string;
}

const TenantAdminScheduling = ({ tenantId }: Props) => {
  // ===== Config da agenda =====
  const [enabled, setEnabled] = useState(false);
  const [openDays, setOpenDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [openTime, setOpenTime] = useState('09:00');
  const [closeTime, setCloseTime] = useState('18:00');
  const [slotMin, setSlotMin] = useState(15);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [capacity, setCapacity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  // ===== Lista de agendamentos =====
  const { data: appointments = [], isLoading } = useAppointments(tenantId);
  const updateMutation = useUpdateAppointment();
  const createMutation = useCreateAppointment();

  // ===== Modal de atraso =====
  const [delayingId, setDelayingId] = useState<string | null>(null);
  const [delayMin, setDelayMin] = useState(15);

  // ===== Modal manual (criar/editar/remarcar) =====
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = novo, string = editar/remarcar
  const [mProductId, setMProductId] = useState<string>('');
  const [mProductName, setMProductName] = useState('');
  const [mDuration, setMDuration] = useState(30);
  const [mDate, setMDate] = useState('');
  const [mTime, setMTime] = useState('');
  const [mCustomerName, setMCustomerName] = useState('');
  const [mCustomerPhone, setMCustomerPhone] = useState('');
  const [mNotes, setMNotes] = useState('');
  const [mSaving, setMSaving] = useState(false);

  useEffect(() => {
    // Carrega serviços agendáveis (item_type=service)
    supabase
      .from('products')
      .select('id, name, duration_minutes, price')
      .eq('tenant_id', tenantId)
      .eq('item_type', 'service')
      .order('name')
      .then(({ data }) => setServices((data ?? []) as ServiceOption[]));
  }, [tenantId]);

  useEffect(() => {
    supabase
      .from('tenants')
      .select('scheduling_enabled, scheduling_open_days, scheduling_open_time, scheduling_close_time, scheduling_slot_minutes, scheduling_auto_confirm, scheduling_capacity')
      .eq('id', tenantId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setEnabled((data as any).scheduling_enabled ?? false);
        setOpenDays((data as any).scheduling_open_days ?? [1, 2, 3, 4, 5, 6]);
        setOpenTime((data as any).scheduling_open_time ?? '09:00');
        setCloseTime((data as any).scheduling_close_time ?? '18:00');
        setSlotMin((data as any).scheduling_slot_minutes ?? 15);
        setAutoConfirm((data as any).scheduling_auto_confirm ?? true);
        setCapacity((data as any).scheduling_capacity ?? 1);
      });
  }, [tenantId]);

  const toggleDay = (d: number) => {
    setOpenDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  };

  const saveConfig = async () => {
    setSaving(true);
    const { error } = await supabase.from('tenants').update({
      scheduling_enabled: enabled,
      scheduling_open_days: openDays,
      scheduling_open_time: openTime,
      scheduling_close_time: closeTime,
      scheduling_slot_minutes: slotMin,
      scheduling_auto_confirm: autoConfirm,
      scheduling_capacity: Math.max(1, capacity || 1),
    } as any).eq('id', tenantId);
    setSaving(false);
    if (error) toast.error('Erro ao salvar: ' + error.message);
    else toast.success('Configuração de agenda salva!');
  };

  // ===== Ações sobre agendamentos =====
  const startService = async (id: string) => {
    await updateMutation.mutateAsync({ id, status: 'in_progress' });
    toast.success('Atendimento iniciado');
  };

  const finishEarly = async (id: string) => {
    await updateMutation.mutateAsync({
      id,
      status: 'done',
      actual_end: new Date().toISOString(),
    });
    toast.success('✓ Finalizado antes do tempo — horários liberados!');
  };

  const finishOnTime = async (id: string) => {
    await updateMutation.mutateAsync({ id, status: 'done' });
    toast.success('Atendimento concluído');
  };

  const applyDelay = async () => {
    if (!delayingId) return;
    const a = appointments.find(x => x.id === delayingId);
    if (!a) return;
    await updateMutation.mutateAsync({
      id: delayingId,
      delay_minutes: (a.delay_minutes || 0) + delayMin,
    });
    toast.success(`+${delayMin} min adicionados ao atendimento`);
    setDelayingId(null);
    setDelayMin(15);
  };

  const cancelAppt = async (id: string) => {
    if (!confirm('Cancelar este agendamento?')) return;
    await updateMutation.mutateAsync({ id, status: 'cancelled' });
    toast.success('Agendamento cancelado');
  };

  // ===== Manual: abrir modal pra novo / editar / remarcar =====
  const resetManual = () => {
    setEditingId(null);
    setMProductId('');
    setMProductName('');
    setMDuration(30);
    setMCustomerName('');
    setMCustomerPhone('');
    setMNotes('');
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30);
    setMDate(now.toISOString().slice(0, 10));
    setMTime(now.toTimeString().slice(0, 5));
  };

  const openNewManual = () => {
    resetManual();
    setManualOpen(true);
  };

  const openReschedule = (id: string) => {
    const a = appointments.find(x => x.id === id);
    if (!a) return;
    setEditingId(id);
    setMProductId(a.product_id || '');
    setMProductName(a.product_name || '');
    setMDuration(a.planned_duration_minutes || 30);
    setMCustomerName(a.customer_name || '');
    setMCustomerPhone(a.customer_phone || '');
    setMNotes(a.notes || '');
    const start = new Date(a.scheduled_start);
    setMDate(start.toISOString().slice(0, 10));
    setMTime(start.toTimeString().slice(0, 5));
    setManualOpen(true);
  };

  const onPickService = (id: string) => {
    setMProductId(id);
    const s = services.find(x => x.id === id);
    if (s) {
      setMProductName(s.name);
      setMDuration(s.duration_minutes || 30);
    }
  };

  const saveManual = async () => {
    if (!mDate || !mTime) return toast.error('Informe data e horário');
    if (!mProductName.trim()) return toast.error('Informe o serviço');
    if (!mCustomerName.trim()) return toast.error('Informe o nome do cliente');
    const scheduled = new Date(`${mDate}T${mTime}:00`);
    if (isNaN(scheduled.getTime())) return toast.error('Data/hora inválida');

    setMSaving(true);
    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          id: editingId,
          scheduled_start: scheduled.toISOString(),
          planned_duration_minutes: mDuration,
          delay_minutes: 0,
          status: 'scheduled',
          actual_end: null,
          product_id: mProductId || null,
          product_name: mProductName,
          customer_name: mCustomerName,
          customer_phone: mCustomerPhone,
          notes: mNotes,
        });
        toast.success('Agendamento atualizado');
      } else {
        const { data: order, error: oErr } = await supabase.from('orders').insert({
          tenant_id: tenantId,
          total: 0,
          delivery_type: 'pickup',
          payment_method: 'pending',
          customer_name: mCustomerName,
          customer_phone: mCustomerPhone,
          customer_address: '(agendamento manual)',
          status: 'received',
        }).select().single();
        if (oErr) throw oErr;
        await createMutation.mutateAsync({
          tenant_id: tenantId,
          order_id: order.id,
          product_id: mProductId || null,
          product_name: mProductName,
          customer_name: mCustomerName,
          customer_phone: mCustomerPhone,
          scheduled_start: scheduled.toISOString(),
          planned_duration_minutes: mDuration,
          notes: mNotes,
          status: 'scheduled',
        });
        toast.success('Agendamento criado!');
      }
      setManualOpen(false);
      resetManual();
    } catch (e: any) {
      toast.error('Erro: ' + (e?.message || e));
    } finally {
      setMSaving(false);
    }
  };

  const todayStr = new Date().toDateString();
  const today = appointments.filter(a => new Date(a.scheduled_start).toDateString() === todayStr);
  const upcoming = appointments.filter(a => new Date(a.scheduled_start).toDateString() !== todayStr && new Date(a.scheduled_start) > new Date());

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      scheduled: { label: 'Agendado', cls: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
      in_progress: { label: 'Em andamento', cls: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' },
      done: { label: 'Finalizado', cls: 'bg-green-500/20 text-green-600 dark:text-green-400' },
      cancelled: { label: 'Cancelado', cls: 'bg-red-500/20 text-red-600 dark:text-red-400' },
      no_show: { label: 'Não compareceu', cls: 'bg-muted text-muted-foreground' },
    };
    const v = map[status] || { label: status, cls: 'bg-muted text-muted-foreground' };
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${v.cls}`}>{v.label}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Configuração */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" /> Configuração da agenda
        </h3>

        <label className="flex items-center gap-3 cursor-pointer rounded-lg border border-border bg-secondary p-3">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-primary" />
          <div>
            <p className="text-sm text-foreground">Habilitar agendamentos nesta loja</p>
            <p className="text-xs text-muted-foreground">Quando ativo, produtos marcados como "Serviço" pedem horário no checkout.</p>
          </div>
        </label>

        <div>
          <label className="text-xs text-muted-foreground">Dias da semana abertos</label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {WEEKDAY_LABELS.map((label, idx) => (
              <button key={idx} type="button" onClick={() => toggleDay(idx)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  openDays.includes(idx) ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary text-muted-foreground'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Hora de abertura</label>
            <input type="time" value={openTime} onChange={e => setOpenTime(e.target.value)}
              className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Hora de fechamento</label>
            <input type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)}
              className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Granularidade dos horários (em minutos)</label>
          <select value={slotMin} onChange={e => setSlotMin(parseInt(e.target.value))}
            className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
            <option value={5}>5 minutos</option>
            <option value={10}>10 minutos</option>
            <option value={15}>15 minutos (recomendado)</option>
            <option value={30}>30 minutos</option>
            <option value={60}>1 hora</option>
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">Define de quanto em quanto tempo os horários aparecem pro cliente. Ex: 15 min → 09:00, 09:15, 09:30...</p>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Atendimentos simultâneos (capacidade da loja)</label>
          <input
            type="number"
            min={1}
            max={50}
            value={capacity}
            onChange={e => setCapacity(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Quantos clientes você consegue atender ao mesmo tempo. Ex: barbearia com 5 cadeiras = <strong>5</strong>. Loja sem agendamento paralelo = <strong>1</strong>. Você ainda pode definir um limite menor por serviço (ex: só 2 barbas ao mesmo tempo) na tela do produto.
          </p>
        </div>

        <label className="flex items-center gap-3 cursor-pointer rounded-lg border border-border bg-secondary p-3">
          <input type="checkbox" checked={autoConfirm} onChange={e => setAutoConfirm(e.target.checked)} className="w-4 h-4 accent-primary" />
          <div>
            <p className="text-sm text-foreground">Auto-confirmar agendamentos</p>
            <p className="text-xs text-muted-foreground">Se desligado, agendamentos chegam como "pendente" pra você aprovar manualmente.</p>
          </div>
        </label>

        <button onClick={saveConfig} disabled={saving}
          className="w-full gradient-primary text-primary-foreground py-2.5 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
          <Save className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar configuração'}
        </button>
      </div>

      {/* Toggle visualização + novo manual */}
      <div className="flex justify-between items-center gap-2">
        <button onClick={openNewManual}
          className="flex items-center gap-1.5 rounded-lg gradient-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> Novo manual
        </button>
        <div className="flex gap-1">
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${viewMode === 'list' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
            <List className="h-3.5 w-3.5" /> Lista
          </button>
          <button onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${viewMode === 'calendar' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
            <CalendarDays className="h-3.5 w-3.5" /> Calendário
          </button>
        </div>
      </div>

      {viewMode === 'calendar' && (
        <WeekCalendarView appointments={appointments} openTime={openTime} closeTime={closeTime} />
      )}

      {/* Hoje */}
      {viewMode === 'list' && (
      <>
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" /> Hoje ({today.length})
        </h3>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : today.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum agendamento pra hoje.</p>
        ) : (
          <div className="space-y-2">
            {today.map(a => {
              const start = new Date(a.scheduled_start);
              const totalMin = (a.planned_duration_minutes || 0) + (a.delay_minutes || 0);
              const end = a.actual_end ? new Date(a.actual_end) : new Date(start.getTime() + totalMin * 60000);
              return (
                <div key={a.id} className="rounded-lg border border-border bg-secondary p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-foreground text-sm">{a.product_name || 'Serviço'}</p>
                        {statusBadge(a.status)}
                        {a.delay_minutes > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-orange-500/20 text-orange-600 dark:text-orange-400">
                            +{a.delay_minutes}min
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} → {end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}{a.planned_duration_minutes}min
                      </p>
                      <p className="text-xs text-muted-foreground">
                        👤 {a.customer_name || '—'} · 📞 {a.customer_phone || '—'}
                      </p>
                    </div>
                  </div>

                  {a.status !== 'done' && a.status !== 'cancelled' && (
                    <div className="flex flex-wrap gap-1.5">
                      {a.status === 'scheduled' && (
                        <button onClick={() => startService(a.id)}
                          className="text-[11px] rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-1 hover:bg-blue-500/30">
                          ▶ Iniciar
                        </button>
                      )}
                      <button onClick={() => finishEarly(a.id)}
                        className="text-[11px] rounded-md bg-green-500/20 text-green-600 dark:text-green-400 px-2 py-1 hover:bg-green-500/30 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Finalizar antes
                      </button>
                      <button onClick={() => finishOnTime(a.id)}
                        className="text-[11px] rounded-md bg-secondary text-foreground border border-border px-2 py-1 hover:bg-muted">
                        ✓ Finalizar
                      </button>
                      <button onClick={() => setDelayingId(a.id)}
                        className="text-[11px] rounded-md bg-orange-500/20 text-orange-600 dark:text-orange-400 px-2 py-1 hover:bg-orange-500/30 flex items-center gap-1">
                        <AlarmClock className="h-3 w-3" /> Vai atrasar
                      </button>
                      <button onClick={() => openReschedule(a.id)}
                        className="text-[11px] rounded-md bg-primary/20 text-primary px-2 py-1 hover:bg-primary/30 flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" /> Remarcar
                      </button>
                      <button onClick={() => cancelAppt(a.id)}
                        className="text-[11px] rounded-md bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-1 hover:bg-red-500/30 flex items-center gap-1">
                        <X className="h-3 w-3" /> Cancelar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Próximos */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-heading text-sm text-foreground flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" /> Próximos ({upcoming.length})
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem agendamentos futuros.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.slice(0, 20).map(a => {
              const start = new Date(a.scheduled_start);
              return (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-secondary p-3 text-sm gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{a.product_name || 'Serviço'}</p>
                    <p className="text-xs text-muted-foreground">
                      {start.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{a.customer_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {statusBadge(a.status)}
                    {a.status !== 'cancelled' && a.status !== 'done' && (
                      <>
                        <button onClick={() => openReschedule(a.id)} title="Remarcar"
                          className="rounded-md bg-primary/20 text-primary p-1.5 hover:bg-primary/30">
                          <CalendarClock className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => cancelAppt(a.id)} title="Cancelar"
                          className="rounded-md bg-red-500/20 text-red-600 dark:text-red-400 p-1.5 hover:bg-red-500/30">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}

      {/* Modal de atraso */}
      {delayingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={() => setDelayingId(null)}>
          <div className="bg-card border border-border rounded-lg p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-heading text-foreground flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-orange-500" /> Adicionar atraso
            </h3>
            <p className="text-xs text-muted-foreground">Os horários seguintes serão empurrados automaticamente.</p>
            <div>
              <label className="text-xs text-muted-foreground">Quantos minutos a mais?</label>
              <input type="number" min={1} value={delayMin} onChange={e => setDelayMin(parseInt(e.target.value) || 0)}
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              <div className="flex gap-2 mt-2">
                {[5, 10, 15, 30, 60].map(m => (
                  <button key={m} onClick={() => setDelayMin(m)}
                    className="flex-1 rounded-md border border-border bg-secondary text-foreground py-1 text-xs hover:border-primary">
                    +{m}min
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDelayingId(null)}
                className="flex-1 rounded-lg border border-border bg-secondary text-foreground py-2 text-sm hover:bg-muted">
                Cancelar
              </button>
              <button onClick={applyDelay}
                className="flex-1 rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90">
                Aplicar atraso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal manual: novo / editar / remarcar */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={() => !mSaving && setManualOpen(false)}>
          <div className="bg-card border border-border rounded-lg p-5 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-heading text-foreground flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              {editingId ? 'Remarcar / editar' : 'Novo agendamento manual'}
            </h3>

            {services.length > 0 ? (
              <div>
                <label className="text-xs text-muted-foreground">Serviço</label>
                <select value={mProductId} onChange={e => onPickService(e.target.value)}
                  className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                  <option value="">— escolher serviço —</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes || 30}min)</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">Ou digite um nome livre abaixo se for serviço avulso.</p>
              </div>
            ) : null}

            <div>
              <label className="text-xs text-muted-foreground">Nome do serviço</label>
              <input value={mProductName} onChange={e => setMProductName(e.target.value)} placeholder="Ex: Corte feminino"
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Data</label>
                <input type="date" value={mDate} onChange={e => setMDate(e.target.value)}
                  className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Hora</label>
                <input type="time" value={mTime} onChange={e => setMTime(e.target.value)}
                  className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Duração (min)</label>
              <input type="number" min={5} step={5} value={mDuration} onChange={e => setMDuration(parseInt(e.target.value) || 30)}
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Cliente</label>
                <input value={mCustomerName} onChange={e => setMCustomerName(e.target.value)} placeholder="Nome"
                  className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Telefone</label>
                <input value={mCustomerPhone} onChange={e => setMCustomerPhone(e.target.value)} placeholder="(11) 9..."
                  className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground" />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Observações</label>
              <textarea value={mNotes} onChange={e => setMNotes(e.target.value)} rows={2} placeholder="Opcional"
                className="w-full mt-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground resize-none" />
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setManualOpen(false)} disabled={mSaving}
                className="flex-1 rounded-lg border border-border bg-secondary text-foreground py-2 text-sm hover:bg-muted disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={saveManual} disabled={mSaving}
                className="flex-1 rounded-lg gradient-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {mSaving ? 'Salvando...' : (editingId ? 'Atualizar' : 'Criar agendamento')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantAdminScheduling;
