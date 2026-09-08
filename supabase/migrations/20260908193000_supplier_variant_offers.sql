-- Ofertas concorrentes por produto, cor e fornecedor.
-- A variante visível continua sendo única; o fornecedor/custo vencedor é recalculado
-- automaticamente a partir da menor oferta disponível.
CREATE TABLE IF NOT EXISTS public.supplier_variant_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_variant_id TEXT REFERENCES public.product_variants(id) ON DELETE SET NULL,
  supplier_id TEXT NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  available BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'supplier_list',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, product_id, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_variant_offers_variant
  ON public.supplier_variant_offers(product_variant_id, available, unit_cost);
CREATE INDEX IF NOT EXISTS idx_supplier_variant_offers_supplier
  ON public.supplier_variant_offers(supplier_id, product_id, available);

ALTER TABLE public.supplier_variant_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read supplier variant offers" ON public.supplier_variant_offers;
CREATE POLICY "Anyone can read supplier variant offers"
  ON public.supplier_variant_offers FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Admins can insert supplier variant offers" ON public.supplier_variant_offers;
CREATE POLICY "Admins can insert supplier variant offers"
  ON public.supplier_variant_offers FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Admins can update supplier variant offers" ON public.supplier_variant_offers;
CREATE POLICY "Admins can update supplier variant offers"
  ON public.supplier_variant_offers FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Admins can delete supplier variant offers" ON public.supplier_variant_offers;
CREATE POLICY "Admins can delete supplier variant offers"
  ON public.supplier_variant_offers FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin', tenant_id) OR has_platform_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.recalculate_variant_supplier_winner(p_variant_id TEXT)
RETURNS VOID AS $$
DECLARE
  winner RECORD;
BEGIN
  SELECT supplier_id, unit_cost INTO winner
  FROM public.supplier_variant_offers
  WHERE product_variant_id = p_variant_id AND available = true
  ORDER BY unit_cost ASC, updated_at DESC
  LIMIT 1;

  UPDATE public.product_variants
  SET supplier_id = winner.supplier_id,
      cost_price = winner.unit_cost,
      price_source = CASE WHEN winner.supplier_id IS NULL THEN price_source ELSE 'supplier_offer' END,
      updated_at = now()
  WHERE id = p_variant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.sync_variant_supplier_winner()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.product_variant_id IS NOT NULL THEN
      PERFORM public.recalculate_variant_supplier_winner(OLD.product_variant_id);
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.product_variant_id IS NOT NULL THEN
    PERFORM public.recalculate_variant_supplier_winner(NEW.product_variant_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.product_variant_id IS DISTINCT FROM NEW.product_variant_id
     AND OLD.product_variant_id IS NOT NULL THEN
    PERFORM public.recalculate_variant_supplier_winner(OLD.product_variant_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS supplier_variant_offer_winner_trigger ON public.supplier_variant_offers;
CREATE TRIGGER supplier_variant_offer_winner_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_variant_offers
FOR EACH ROW EXECUTE FUNCTION public.sync_variant_supplier_winner();

DROP TRIGGER IF EXISTS update_supplier_variant_offers_updated_at ON public.supplier_variant_offers;
CREATE TRIGGER update_supplier_variant_offers_updated_at
BEFORE UPDATE ON public.supplier_variant_offers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
