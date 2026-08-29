-- Tenant flags
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS quotes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quotes_intro_text text NOT NULL DEFAULT '';

-- Variáveis da calculadora
CREATE TABLE IF NOT EXISTS public.quote_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'unidade',
  price_per_unit numeric NOT NULL DEFAULT 0,
  min_quantity numeric NOT NULL DEFAULT 1,
  max_quantity numeric,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_variables_tenant ON public.quote_variables(tenant_id, sort_order);

ALTER TABLE public.quote_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read quote variables"
  ON public.quote_variables FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert quote variables"
  ON public.quote_variables FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can update quote variables"
  ON public.quote_variables FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can delete quote variables"
  ON public.quote_variables FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_quote_variables_updated_at
  BEFORE UPDATE ON public.quote_variables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pacotes pré-definidos
CREATE TABLE IF NOT EXISTS public.quote_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_packages_tenant ON public.quote_packages(tenant_id, sort_order);

ALTER TABLE public.quote_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read quote packages"
  ON public.quote_packages FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert quote packages"
  ON public.quote_packages FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can update quote packages"
  ON public.quote_packages FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can delete quote packages"
  ON public.quote_packages FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_quote_packages_updated_at
  BEFORE UPDATE ON public.quote_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();