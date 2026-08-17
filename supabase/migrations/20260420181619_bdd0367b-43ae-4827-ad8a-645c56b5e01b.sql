-- Tabela de agendamentos
CREATE TABLE public.appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  product_id uuid,
  product_name text NOT NULL DEFAULT '',
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  scheduled_start timestamp with time zone NOT NULL,
  planned_duration_minutes integer NOT NULL DEFAULT 30,
  actual_end timestamp with time zone,
  status text NOT NULL DEFAULT 'scheduled',
  delay_minutes integer NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_tenant_start ON public.appointments(tenant_id, scheduled_start);
CREATE INDEX idx_appointments_order ON public.appointments(order_id);
CREATE INDEX idx_appointments_status ON public.appointments(tenant_id, status);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read appointments"
  ON public.appointments FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can update appointments"
  ON public.appointments FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can delete appointments"
  ON public.appointments FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Configurações de agenda no tenant
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS scheduling_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduling_open_days integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6]::integer[],
  ADD COLUMN IF NOT EXISTS scheduling_open_time text NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS scheduling_close_time text NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS scheduling_slot_minutes integer NOT NULL DEFAULT 15;