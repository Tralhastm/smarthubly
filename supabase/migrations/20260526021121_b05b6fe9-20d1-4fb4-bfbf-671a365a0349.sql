
-- =============== Fila offline NFC-e ===============
CREATE TABLE IF NOT EXISTS public.fiscal_offline_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued, processing, emitted, failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  emitted_invoice_id UUID REFERENCES public.fiscal_invoices(id) ON DELETE SET NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offq_tenant_status ON public.fiscal_offline_queue(tenant_id, status, enqueued_at);

ALTER TABLE public.fiscal_offline_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offq_admin_all" ON public.fiscal_offline_queue FOR ALL
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_offq_updated_at BEFORE UPDATE ON public.fiscal_offline_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============== Cancelamentos e inutilizações ===============
CREATE TABLE IF NOT EXISTS public.fiscal_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'cancel' | 'invalidate'
  invoice_id UUID REFERENCES public.fiscal_invoices(id) ON DELETE SET NULL,
  numero_inicial INTEGER,
  numero_final INTEGER,
  serie INTEGER,
  justificativa TEXT NOT NULL,
  protocolo TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, success, failed
  error_message TEXT,
  performed_by UUID,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT justificativa_min_length CHECK (length(justificativa) >= 15)
);
CREATE INDEX IF NOT EXISTS idx_fcanc_tenant ON public.fiscal_cancellations(tenant_id, performed_at DESC);

ALTER TABLE public.fiscal_cancellations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcanc_admin_all" ON public.fiscal_cancellations FOR ALL
  USING (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id) OR public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_fcanc_updated_at BEFORE UPDATE ON public.fiscal_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============== SAT (SP) em fiscal_settings ===============
ALTER TABLE public.fiscal_settings
  ADD COLUMN IF NOT EXISTS sat_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sat_serial TEXT,
  ADD COLUMN IF NOT EXISTS sat_assinatura_ac TEXT,
  ADD COLUMN IF NOT EXISTS sat_codigo_ativacao TEXT,
  ADD COLUMN IF NOT EXISTS offline_mode_enabled BOOLEAN DEFAULT true;

-- =============== Função para enfileirar offline ===============
CREATE OR REPLACE FUNCTION public.enqueue_offline_nfce(_tenant_id UUID, _order_id UUID, _payload JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.fiscal_offline_queue (tenant_id, order_id, payload)
  VALUES (_tenant_id, _order_id, _payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- =============== Helper: pedidos canceláveis (< 30min) ===============
CREATE OR REPLACE FUNCTION public.can_cancel_nfce(_invoice_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_invoices
    WHERE id = _invoice_id
      AND status = 'authorized'
      AND emitted_at IS NOT NULL
      AND emitted_at > now() - interval '30 minutes'
  );
$$;
