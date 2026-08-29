CREATE TABLE public.integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  financeflow_url text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  sync_orders boolean NOT NULL DEFAULT true,
  sync_products boolean NOT NULL DEFAULT true,
  sync_stock boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status text NOT NULL DEFAULT '',
  last_sync_error text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view own integration settings"
  ON public.integration_settings FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can insert own integration settings"
  ON public.integration_settings FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can update own integration settings"
  ON public.integration_settings FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can delete own integration settings"
  ON public.integration_settings FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER trg_integration_settings_updated
  BEFORE UPDATE ON public.integration_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_integration_settings_tenant ON public.integration_settings(tenant_id);