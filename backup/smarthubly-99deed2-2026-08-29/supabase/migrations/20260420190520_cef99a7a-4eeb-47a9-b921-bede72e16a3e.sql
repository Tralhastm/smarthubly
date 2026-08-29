-- 1. Variações de produto (P/M/G, sabores)
CREATE TABLE public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_delta NUMERIC NOT NULL DEFAULT 0,
  in_stock BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read variants" ON public.product_variants FOR SELECT TO public USING (true);
CREATE POLICY "Admins can insert variants" ON public.product_variants FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update variants" ON public.product_variants FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete variants" ON public.product_variants FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_product_variants_product ON public.product_variants(product_id);
CREATE INDEX idx_product_variants_tenant ON public.product_variants(tenant_id);

CREATE TRIGGER update_product_variants_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Adicionais de produto (com bacon, +queijo)
CREATE TABLE public.product_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT false,
  max_quantity INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read addons" ON public.product_addons FOR SELECT TO public USING (true);
CREATE POLICY "Admins can insert addons" ON public.product_addons FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can update addons" ON public.product_addons FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can delete addons" ON public.product_addons FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_product_addons_product ON public.product_addons(product_id);
CREATE INDEX idx_product_addons_tenant ON public.product_addons(tenant_id);

CREATE TRIGGER update_product_addons_updated_at BEFORE UPDATE ON public.product_addons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Adicionar campos de variação/adicionais escolhidos no order_items
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_name TEXT,
  ADD COLUMN IF NOT EXISTS addons JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

-- 4. Remover R$5 fixo: mudar default platform_fee de 5.00 para 0
ALTER TABLE public.orders ALTER COLUMN platform_fee SET DEFAULT 0;
ALTER TABLE public.tenants ALTER COLUMN platform_fee SET DEFAULT 0;

-- 5. Validar exclusividade do billing_mode via trigger
-- billing_mode pode ser 'per_order' (cobra %) ou 'monthly_fixed' (cobra mensalidade)
CREATE OR REPLACE FUNCTION public.validate_billing_mode()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.billing_mode NOT IN ('per_order', 'monthly_fixed') THEN
    RAISE EXCEPTION 'billing_mode deve ser "per_order" ou "monthly_fixed"';
  END IF;
  -- Se for per_order, monthly_fee é ignorado (zera)
  IF NEW.billing_mode = 'per_order' THEN
    NEW.monthly_fee := 0;
  END IF;
  -- Se for monthly_fixed, platform_fee_percent zera (não cobra % por pedido)
  IF NEW.billing_mode = 'monthly_fixed' THEN
    NEW.platform_fee_percent := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS validate_billing_mode_trigger ON public.tenants;
CREATE TRIGGER validate_billing_mode_trigger
BEFORE INSERT OR UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.validate_billing_mode();