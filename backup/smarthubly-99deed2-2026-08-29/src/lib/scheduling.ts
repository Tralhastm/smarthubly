/**
 * Lógica de slots de agendamento.
 *
 * Como funciona:
 * - Lojista define dias da semana abertos, hora de abertura/fechamento e granularidade do slot.
 * - Cada serviço tem `duration_minutes`.
 * - Pra um dia X e duração D, geramos todos os slots possíveis (a cada `slot_minutes`)
 *   e filtramos os que conflitam com appointments já marcados.
 * - Conflito = se o intervalo [novo_start, novo_start+D) cruza qualquer appointment existente
 *   que esteja com status ativo (scheduled, in_progress) considerando seu delay.
 */
import type { Tables } from '@/integrations/supabase/types';

export type Appointment = Tables<'appointments'>;

export interface SchedulingConfig {
  scheduling_enabled?: boolean;
  scheduling_open_days?: number[] | null;
  scheduling_open_time?: string;
  scheduling_close_time?: string;
  scheduling_slot_minutes?: number;
  /** Quantos atendimentos a loja faz ao mesmo tempo (ex: 5 cadeiras). Default 1. */
  scheduling_capacity?: number;
}

export type AppointmentStatus = 'scheduled' | 'in_progress' | 'done' | 'cancelled' | 'no_show';

const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'in_progress'];

/** Combina YYYY-MM-DD + HH:MM em Date local. */
const toLocalDate = (yyyymmdd: string, hhmm: string): Date => {
  const [y, mo, d] = yyyymmdd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0, 0);
};

/** YYYY-MM-DD na timezone local (sem UTC). */
export const formatLocalDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const formatTime = (d: Date): string => {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Calcula fim efetivo de um appointment (planejado + atraso). */
export const getAppointmentEnd = (a: Appointment): Date => {
  if (a.actual_end) return new Date(a.actual_end);
  const start = new Date(a.scheduled_start);
  const totalMin = (a.planned_duration_minutes || 0) + (a.delay_minutes || 0);
  return new Date(start.getTime() + totalMin * 60 * 1000);
};

/** Retorna true se o tenant está aberto naquele dia da semana. */
export const isOpenDay = (date: Date, config: SchedulingConfig): boolean => {
  const days = config.scheduling_open_days ?? [1, 2, 3, 4, 5, 6];
  // Date.getDay(): 0=domingo, 1=segunda, ..., 6=sábado
  return days.includes(date.getDay());
};

/**
 * Gera slots disponíveis pra uma data + duração desejada.
 *
 * Capacidade: o slot é considerado livre enquanto o nº de appointments ATIVOS
 * que cobrem esse intervalo for MENOR que `effectiveCapacity` (mínimo entre
 * a capacidade da loja e a do serviço, se definida).
 *
 * Importante: a função filtra appointments pelo `product_id` quando
 * `serviceProductId` é informado E o serviço tem `max_concurrent`. Caso
 * contrário, conta TODOS os appointments do dia (capacidade da loja inteira).
 */
export const computeAvailableSlots = (
  date: Date,
  durationMinutes: number,
  config: SchedulingConfig,
  existingAppointments: Appointment[],
  options?: {
    /** Limite simultâneo do serviço específico (NULL = só usa o teto da loja). */
    serviceMaxConcurrent?: number | null;
    /** Id do produto/serviço atual (pra filtrar conflitos por serviço quando aplicável). */
    serviceProductId?: string | null;
  },
): Date[] => {
  if (!isOpenDay(date, config)) return [];
  if (!durationMinutes || durationMinutes <= 0) return [];

  const slotMinutes = Math.max(5, config.scheduling_slot_minutes ?? 15);
  const tenantCap = Math.max(1, config.scheduling_capacity ?? 1);
  const svcCap = options?.serviceMaxConcurrent && options.serviceMaxConcurrent > 0
    ? options.serviceMaxConcurrent : null;
  // Capacidade efetiva = min(tenant, serviço). Se serviço não tem limite, usa só tenant.
  const effectiveCapacity = svcCap ? Math.min(tenantCap, svcCap) : tenantCap;

  const dateStr = formatLocalDate(date);
  const dayStart = toLocalDate(dateStr, config.scheduling_open_time || '09:00');
  const dayEnd = toLocalDate(dateStr, config.scheduling_close_time || '18:00');

  // Filtra appointments do mesmo dia ativos
  const dayAppointmentsAll = existingAppointments
    .filter(a => ACTIVE_STATUSES.includes(a.status as AppointmentStatus))
    .filter(a => formatLocalDate(new Date(a.scheduled_start)) === dateStr)
    .map(a => ({
      productId: a.product_id,
      start: new Date(a.scheduled_start),
      end: getAppointmentEnd(a),
    }));

  // Pra contagem por serviço (quando serviço tem limite próprio), filtra só do mesmo product_id
  const sameServiceAppointments = options?.serviceProductId && svcCap
    ? dayAppointmentsAll.filter(a => a.productId === options.serviceProductId)
    : dayAppointmentsAll;

  const slots: Date[] = [];
  const now = new Date();

  for (
    let cursor = new Date(dayStart);
    cursor.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime();
    cursor = new Date(cursor.getTime() + slotMinutes * 60 * 1000)
  ) {
    if (cursor.getTime() < now.getTime()) continue;
    const slotEnd = new Date(cursor.getTime() + durationMinutes * 60 * 1000);

    // Conta quantos appointments do MESMO serviço (se limite por serviço) cobrem o intervalo
    const overlapsService = sameServiceAppointments.filter(a => cursor < a.end && slotEnd > a.start).length;
    if (svcCap && overlapsService >= svcCap) continue;

    // Conta TOTAL de appointments cobrindo o intervalo (teto da loja)
    const overlapsTotal = dayAppointmentsAll.filter(a => cursor < a.end && slotEnd > a.start).length;
    if (overlapsTotal >= tenantCap) continue;

    // Garantia adicional: nunca passa do effectiveCapacity (já coberto acima, mas explícito)
    if (overlapsTotal >= effectiveCapacity) continue;

    slots.push(new Date(cursor));
  }
  return slots;
};

/** Gera os próximos N dias abertos a partir de hoje. */
export const getNextOpenDays = (config: SchedulingConfig, days = 14): Date[] => {
  const result: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days * 2 && result.length < days; i++) {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    if (isOpenDay(d, config)) result.push(d);
  }
  return result;
};

export const formatDayLabel = (d: Date): string => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dd.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Amanhã';
  const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return `${weekdays[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
