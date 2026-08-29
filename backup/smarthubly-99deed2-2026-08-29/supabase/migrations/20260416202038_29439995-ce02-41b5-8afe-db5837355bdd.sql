-- order_reviews
CREATE TABLE public.order_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE,
  tenant_id UUID NOT NULL,
  supplier_id UUID,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert reviews"
  ON public.order_reviews FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Anyone can update reviews"
  ON public.order_reviews FOR UPDATE TO anon, authenticated USING (true);

CREATE POLICY "Anyone can read reviews"
  ON public.order_reviews FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX idx_order_reviews_tenant ON public.order_reviews(tenant_id);
CREATE INDEX idx_order_reviews_supplier ON public.order_reviews(supplier_id);

CREATE TRIGGER update_order_reviews_updated_at
  BEFORE UPDATE ON public.order_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- coupons
CREATE TABLE public.coupons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
  discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
  min_order_value NUMERIC NOT NULL DEFAULT 0,
  max_uses INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read coupons"
  ON public.coupons FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins can insert coupons"
  ON public.coupons FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can update coupons"
  ON public.coupons FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can delete coupons"
  ON public.coupons FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "Anon can update coupon uses"
  ON public.coupons FOR UPDATE TO anon USING (true);

CREATE INDEX idx_coupons_tenant ON public.coupons(tenant_id);
CREATE INDEX idx_coupons_code ON public.coupons(tenant_id, code);

CREATE TRIGGER update_coupons_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- orders: add coupon fields
ALTER TABLE public.orders
  ADD COLUMN coupon_code TEXT,
  ADD COLUMN discount_amount NUMERIC NOT NULL DEFAULT 0;