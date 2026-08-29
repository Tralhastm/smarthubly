import { useState, useMemo } from 'react';
import type { Tables } from '@/integrations/supabase/types';
import { ChevronLeft, ChevronRight, CalendarDays, List } from 'lucide-react';

type Appointment = Tables<'appointments'>;

interface Props {
  appointments: Appointment[];
  openTime?: string;
  closeTime?: string;
  onAppointmentClick?: (a: Appointment) => void;
}

// Calendário semanal estilo Google Calendar — visualização compacta dos
// agendamentos por dia/hora. Pra mobile, os horários ficam empilhados em
// scroll horizontal.
const WeekCalendarView = ({ appointments, openTime = '09:00', closeTime = '18:00', onAppointmentClick }: Props) => {
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay(); // 0 = dom
    const diff = day === 0 ? -6 : 1 - day; // segunda como início
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [view, setView] = useState<'week' | 'day'>('week');

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const [openH] = openTime.split(':').map(Number);
  const [closeH] = closeTime.split(':').map(Number);
  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = openH; h <= closeH; h++) list.push(h);
    return list;
  }, [openH, closeH]);

  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    days.forEach(d => map.set(d.toDateString(), []));
    appointments.forEach(a => {
      const dStr = new Date(a.scheduled_start).toDateString();
      if (map.has(dStr)) map.get(dStr)!.push(a);
    });
    return map;
  }, [appointments, days]);

  const navigate = (deltaDays: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + deltaDays);
    setWeekStart(d);
  };

  const goToday = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    setWeekStart(d);
  };

  const todayStr = new Date().toDateString();

  const statusColor = (status: string) => {
    switch (status) {
      case 'in_progress': return 'bg-yellow-500/30 border-yellow-500/60 text-yellow-700 dark:text-yellow-300';
      case 'done': return 'bg-green-500/20 border-green-500/40 text-green-700 dark:text-green-300';
      case 'cancelled': return 'bg-red-500/20 border-red-500/40 text-red-700 dark:text-red-300 line-through';
      default: return 'bg-blue-500/30 border-blue-500/60 text-blue-700 dark:text-blue-300';
    }
  };

  const renderDayCol = (day: Date, isCompact: boolean) => {
    const dStr = day.toDateString();
    const isToday = dStr === todayStr;
    const list = (apptsByDay.get(dStr) || []).sort((a, b) =>
      new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
    );
    return (
      <div key={dStr} className={`flex-1 min-w-0 border-r border-border last:border-r-0 ${isCompact ? 'min-w-[150px]' : ''}`}>
        <div className={`text-center py-2 border-b border-border sticky top-0 z-10 ${isToday ? 'bg-primary/10' : 'bg-card'}`}>
          <p className="text-[10px] uppercase text-muted-foreground">
            {day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}
          </p>
          <p className={`text-sm font-medium ${isToday ? 'text-primary' : 'text-foreground'}`}>
            {day.getDate()}
          </p>
        </div>
        <div className="relative">
          {hours.map(h => (
            <div key={h} className="h-12 border-b border-border/40" />
          ))}
          {list.map(a => {
            const start = new Date(a.scheduled_start);
            const startMin = start.getHours() * 60 + start.getMinutes();
            const totalMin = (a.planned_duration_minutes || 30) + (a.delay_minutes || 0);
            const top = ((startMin - openH * 60) / 60) * 48; // 48px por hora
            const height = Math.max((totalMin / 60) * 48 - 2, 22);
            return (
              <button
                key={a.id}
                onClick={() => onAppointmentClick?.(a)}
                className={`absolute left-1 right-1 rounded-md border px-1.5 py-1 text-left overflow-hidden hover:opacity-80 transition ${statusColor(a.status)}`}
                style={{ top: `${top}px`, height: `${height}px` }}
                title={`${a.product_name} - ${a.customer_name}`}
              >
                <p className="text-[10px] font-bold leading-tight truncate">
                  {start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-[10px] leading-tight truncate">{a.product_name}</p>
                {height > 30 && <p className="text-[9px] opacity-80 leading-tight truncate">{a.customer_name}</p>}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const visibleDays = view === 'day' ? [new Date()] : days;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-border gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-7)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={goToday} className="px-2 py-1 text-xs rounded-md bg-secondary text-foreground hover:bg-muted">Hoje</button>
          <button onClick={() => navigate(7)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <p className="text-sm font-medium text-foreground">
          {weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – {days[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })}
        </p>
        <div className="flex items-center gap-1">
          <button onClick={() => setView('week')} className={`p-1.5 rounded-md ${view === 'week' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary'}`} title="Semana">
            <CalendarDays className="h-4 w-4" />
          </button>
          <button onClick={() => setView('day')} className={`p-1.5 rounded-md ${view === 'day' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary'}`} title="Hoje">
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-fit">
          {/* Coluna de horas */}
          <div className="w-12 shrink-0 border-r border-border">
            <div className="h-[60px] border-b border-border" />
            {hours.map(h => (
              <div key={h} className="h-12 flex items-start justify-end pr-1.5 pt-0.5 text-[10px] text-muted-foreground">
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {/* Dias */}
          <div className="flex flex-1 min-w-0">
            {visibleDays.map(d => renderDayCol(d, view === 'day'))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeekCalendarView;
