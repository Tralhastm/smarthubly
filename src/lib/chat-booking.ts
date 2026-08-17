import { supabase } from '@/integrations/supabase/client';
import {
  computeAvailableSlots,
  formatDayLabel,
  formatTime,
  getNextOpenDays,
  type Appointment,
  type SchedulingConfig,
} from '@/lib/scheduling';

export type ChatBookingPayload = {
  product_name: string;
  scheduled_start: string;
  customer_name: string;
  customer_phone: string;
  duration_minutes?: number;
};

export const stripBookBlock = (text: string): string =>
  text.replace(/\[BOOK\][\s\S]*?\[\/BOOK\]/g, '').trim();

export const extractBooking = (text: string): ChatBookingPayload | null => {
  const match = text.match(/\[BOOK\]([\s\S]*?)\[\/BOOK\]/);
  if (!match) return null;

  try {
    return JSON.parse(match[1].trim()) as ChatBookingPayload;
  } catch {
    return null;
  }
};

export const formatBookingWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

type ChatBookingResult =
  | { ok: true; product: string; when: string }
  | { ok: false; message: string };

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const buildUnavailableMessage = (
  desiredStart: Date,
  durationMinutes: number,
  config: SchedulingConfig,
  appointments: Appointment[],
  serviceMaxConcurrent?: number | null,
  serviceProductId?: string | null,
) => {
  const suggestions: string[] = [];

  for (const day of getNextOpenDays(config, 7)) {
    const slots = computeAvailableSlots(day, durationMinutes, config, appointments, {
      serviceMaxConcurrent,
      serviceProductId,
    });
    for (const slot of slots) {
      suggestions.push(`${formatDayLabel(slot)} às ${formatTime(slot)}`);
      if (suggestions.length >= 4) break;
    }
    if (suggestions.length >= 4) break;
  }

  const desiredLabel = `${formatDayLabel(desiredStart)} às ${formatTime(desiredStart)}`;
  if (suggestions.length === 0) {
    return `Esse horário (${desiredLabel}) não está mais livre. Pede pra pessoa escolher outro horário com a loja.`;
  }

  return `Esse horário (${desiredLabel}) não está mais livre. Os próximos disponíveis são: ${suggestions.join(', ')}.`;
};

export const createChatBooking = async (
  tenantId: string,
  booking: ChatBookingPayload,
): Promise<ChatBookingResult> => {
  const scheduledStart = new Date(booking.scheduled_start);
  if (Number.isNaN(scheduledStart.getTime())) {
    return { ok: false, message: 'Não consegui validar a data e horário informados.' };
  }

  const [{ data: services, error: productsError }, { data: tenant, error: tenantError }, { data: appointments, error: appointmentsError }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, duration_minutes, max_concurrent')
      .eq('tenant_id', tenantId)
      .eq('item_type', 'service'),
    (supabase as any)
      .from('tenants_public')
      .select('scheduling_enabled, scheduling_open_days, scheduling_open_time, scheduling_close_time, scheduling_slot_minutes, scheduling_capacity')
      .eq('id', tenantId)
      .maybeSingle(),
    (supabase as any)
      .from('appointments_public')
      .select('id, tenant_id, order_id, product_id, product_name, scheduled_start, planned_duration_minutes, status, delay_minutes')
      .eq('tenant_id', tenantId)
      .gte('scheduled_start', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
      .in('status', ['scheduled', 'in_progress']),
  ]);

  if (productsError || tenantError || appointmentsError) {
    throw productsError || tenantError || appointmentsError;
  }

  if (!tenant?.scheduling_enabled) {
    return { ok: false, message: 'A agenda da loja não está habilitada para confirmação automática.' };
  }

  const service = (services || []).find((product) => normalize(product.name) === normalize(booking.product_name));
  if (!service) {
    return { ok: false, message: `Não encontrei o serviço "${booking.product_name}" para confirmar esse agendamento.` };
  }

  const durationMinutes = booking.duration_minutes || service.duration_minutes || 30;
  const config: SchedulingConfig = {
    scheduling_enabled: tenant.scheduling_enabled,
    scheduling_open_days: tenant.scheduling_open_days,
    scheduling_open_time: tenant.scheduling_open_time,
    scheduling_close_time: tenant.scheduling_close_time,
    scheduling_slot_minutes: tenant.scheduling_slot_minutes,
    scheduling_capacity: tenant.scheduling_capacity,
  };

  const activeAppointments = (appointments || []) as Appointment[];
  const availableSlots = computeAvailableSlots(scheduledStart, durationMinutes, config, activeAppointments, {
    serviceMaxConcurrent: (service as any).max_concurrent,
    serviceProductId: service.id,
  });
  const isRequestedSlotAvailable = availableSlots.some((slot) => slot.getTime() === scheduledStart.getTime());

  if (!isRequestedSlotAvailable) {
    return {
      ok: false,
      message: buildUnavailableMessage(
        scheduledStart,
        durationMinutes,
        config,
        activeAppointments,
        (service as any).max_concurrent,
        service.id,
      ),
    };
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      tenant_id: tenantId,
      customer_name: booking.customer_name,
      customer_phone: booking.customer_phone,
      delivery_type: 'pickup',
      payment_method: 'pending',
      total: 0,
      status: 'received',
    })
    .select('id')
    .single();

  if (orderError) throw orderError;

  const { error: appointmentError } = await supabase.from('appointments').insert({
    tenant_id: tenantId,
    order_id: order.id,
    product_id: service.id,
    product_name: service.name,
    customer_name: booking.customer_name,
    customer_phone: booking.customer_phone,
    scheduled_start: scheduledStart.toISOString(),
    planned_duration_minutes: durationMinutes,
    status: 'scheduled',
  });

  if (appointmentError) throw appointmentError;

  return {
    ok: true,
    product: service.name,
    when: formatBookingWhen(scheduledStart.toISOString()),
  };
};