-- 1) Novos campos em tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS store_mode text NOT NULL DEFAULT 'delivery';

-- 2) Novos campos em products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS affiliate_url text,
  ADD COLUMN IF NOT EXISTS affiliate_network text;

-- 3) Tabela de cliques de afiliado
CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text,
  referrer text
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_tenant ON public.affiliate_clicks(tenant_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_product ON public.affiliate_clicks(product_id, clicked_at DESC);

ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can register click"
  ON public.affiliate_clicks FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Tenant admins and super admins can view clicks"
  ON public.affiliate_clicks FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

CREATE POLICY "Super admins can delete clicks"
  ON public.affiliate_clicks FOR DELETE
  TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));