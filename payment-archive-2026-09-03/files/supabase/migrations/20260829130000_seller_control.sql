-- Controle de vendedores, códigos, comissões e repasses
CREATE TABLE IF NOT EXISTS public.sellers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  pix_key text,
  pix_key_type text,
  commission_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_codes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  seller_id text NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  code text NOT NULL,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  active boolean NOT NULL DEFAULT true,
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS public.seller_order_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id text REFERENCES public.order_items(id) ON DELETE SET NULL,
  seller_id text NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  seller_code_id text NOT NULL REFERENCES public.seller_codes(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price_before_discount numeric(12,2) NOT NULL DEFAULT 0,
  unit_price_after_discount numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  commission_percent numeric(5,2) NOT NULL DEFAULT 0,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_payouts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  seller_id text NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  paid_at timestamptz,
  payment_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS seller_code_id text REFERENCES public.seller_codes(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS seller_id text REFERENCES public.sellers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sellers_tenant ON public.sellers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_seller_codes_tenant ON public.seller_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_seller_codes_code ON public.seller_codes(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_seller_order_items_tenant_seller ON public.seller_order_items(tenant_id, seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_order_items_order ON public.seller_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_tenant_seller ON public.seller_payouts(tenant_id, seller_id);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY sellers_tenant_access ON public.sellers FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()));
CREATE POLICY seller_codes_tenant_access ON public.seller_codes FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()));
CREATE POLICY seller_order_items_tenant_access ON public.seller_order_items FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()));
CREATE POLICY seller_payouts_tenant_access ON public.seller_payouts FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()));

-- O checkout público precisa validar códigos ativos sem expor dados pessoais do vendedor.
CREATE OR REPLACE VIEW public.seller_codes_public AS
SELECT id, tenant_id, seller_id, code, discount_type, discount_value, active, max_uses, uses_count, expires_at
FROM public.seller_codes;
GRANT SELECT ON public.seller_codes_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_seller_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS sellers_touch_updated_at ON public.sellers;
CREATE TRIGGER sellers_touch_updated_at BEFORE UPDATE ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.touch_seller_updated_at();
DROP TRIGGER IF EXISTS seller_codes_touch_updated_at ON public.seller_codes;
CREATE TRIGGER seller_codes_touch_updated_at BEFORE UPDATE ON public.seller_codes FOR EACH ROW EXECUTE FUNCTION public.touch_seller_updated_at();
