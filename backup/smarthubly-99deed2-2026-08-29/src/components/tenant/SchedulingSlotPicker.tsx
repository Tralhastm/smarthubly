import { useMemo, useState, useEffect } from 'react';
import { Calendar, Clock, Loader2 } from 'lucide-react';
import {
  computeAvailableSlots,
  formatDayLabel,
  formatTime,
  getNextOpenDays,
  type SchedulingConfig,
} from '@/lib/scheduling';
import { useTenantUpcomingAppointments } from '@/hooks/useAppointments';

interface Props {
  tenantId: string;
  config: SchedulingConfig;
  /** Duração em minutos do serviço (somatório dos itens agendáveis). */
  durationMinutes: number;
  value: Date | null;
  onChange: (d: Date | null) => void;
  /** Limite simultâneo do serviço (NULL = só o teto da loja). */
  serviceMaxConcurrent?: number | null;
  /** Id do produto/serviço (pra contar conflitos só do mesmo serviço quando houver limite). */
  serviceProductId?: string | null;
}

const SchedulingSlotPicker = ({ tenantId, config, durationMinutes, value, onChange, serviceMaxConcurrent, serviceProductId }: Props) => {
  const { data: appointments = [], isLoading } = useTenantUpcomingAppointments(tenantId);
  const days = useMemo(() => getNextOpenDays(config, 14), [config]);
  const [selectedDay, setSelectedDay] = useState<Date | null>(value ?? days[0] ?? null);

  useEffect(() => {
    if (!selectedDay && days[0]) setSelectedDay(days[0]);
  }, [days, selectedDay]);

  const slots = useMemo(() => {
    if (!selectedDay) return [];
    return computeAvailableSlots(selectedDay, durationMinutes, config, appointments, {
      serviceMaxConcurrent,
      serviceProductId,
    });
  }, [selectedDay, durationMinutes, config, appointments, serviceMaxConcurrent, serviceProductId]);

  const isSelectedSlot = (slot: Date): boolean => {
    if (!value) return false;
    return Math.abs(slot.getTime() - value.getTime()) < 60000;
  };

  if (!config.scheduling_enabled) {
    return (
      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
        ⚠️ A loja ainda não habilitou agendamentos. Fale com o lojista.
      </div>
    );
  }

  if (durationMinutes <= 0) {
    return (
      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
        ⚠️ Este serviço não tem duração configurada. Avise o lojista.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-foreground flex items-center gap-2 mb-2">
          <Calendar className="h-4 w-4 text-primary" /> Escolha o dia
        </label>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {days.map(d => {
            const isSelected = selectedDay && formatDayLabel(d) === formatDayLabel(selectedDay);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => { setSelectedDay(d); onChange(null); }}
                className={`flex-shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-secondary text-muted-foreground hover:border-primary/50'
                }`}
              >
                {formatDayLabel(d)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground flex items-center gap-2 mb-2">
          <Clock className="h-4 w-4 text-primary" /> Horários disponíveis
          <span className="text-xs text-muted-foreground font-normal">
            ({durationMinutes} min)
          </span>
        </label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando agenda...
          </div>
        ) : slots.length === 0 ? (
          <div className="rounded-lg border border-border bg-secondary p-3 text-xs text-muted-foreground">
            Sem horários livres neste dia. Tente outro dia.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slots.map(s => (
              <button
                key={s.toISOString()}
                type="button"
                onClick={() => onChange(s)}
                className={`rounded-lg border py-2 text-sm font-medium transition-all ${
                  isSelectedSlot(s)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-secondary text-foreground hover:border-primary/50'
                }`}
              >
                {formatTime(s)}
              </button>
            ))}
          </div>
        )}
      </div>

      {value && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-3 text-xs">
          <p className="font-medium text-green-700 dark:text-green-400">
            ✓ Horário escolhido: {formatDayLabel(value)} às {formatTime(value)}
          </p>
          <p className="text-muted-foreground mt-1">
            Duração estimada: {durationMinutes} min
          </p>
        </div>
      )}
    </div>
  );
};

export default SchedulingSlotPicker;
