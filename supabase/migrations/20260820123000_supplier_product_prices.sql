-- Tabela de preços de produtos por fornecedor (para o seletor de melhor preço
-- e fragmentação de pedidos de compra por fornecedor).
CREATE TABLE IF NOT EXISTS public.supplier_product_prices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  supplier_id text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  available boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, product_name)
);

CREATE INDEX IF NOT EXISTS idx_supplier_product_prices_supplier_id
  ON public.supplier_product_prices (supplier_id);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.supplier_product_prices_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplier_product_prices_updated_at ON public.supplier_product_prices;
CREATE TRIGGER supplier_product_prices_updated_at
  BEFORE UPDATE ON public.supplier_product_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.supplier_product_prices_touch_updated_at();

-- Política de acesso:
--  - Fornecedores (tenants com perfil supplier) e o Super Admin podem gerenciar
--  - Lojistas revendedores podem LER os preços dos fornecedores ativos
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_product_prices TO authenticated;

ALTER TABLE public.supplier_product_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fornecedores gerenciam seus preços" ON public.supplier_product_prices;
CREATE POLICY "Fornecedores gerenciam seus preços"
  ON public.supplier_product_prices
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = supplier_product_prices.supplier_id
      -- Qualquer tenant autenticado pode gerenciar os preços dos seus próprios fornecedores
      AND s.tenant_id IN (
        SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Lojistas leem preços de fornecedores ativos" ON public.supplier_product_prices;
CREATE POLICY "Lojistas leem preços de fornecedores ativos"
  ON public.supplier_product_prices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = supplier_product_prices.supplier_id
      AND s.active::boolean = true
    )
  );
