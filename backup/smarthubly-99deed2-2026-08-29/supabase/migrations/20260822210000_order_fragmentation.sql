-- Tabela de fragmentos de pedidos (fragmentação operacional)
CREATE TABLE IF NOT EXISTS public.order_fragments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id text NOT NULL REFERENCES public.suppliers(id),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(12,2) NOT NULL DEFAULT 0, -- Nomeado 'total' para bater com o insert do frontend
  status text NOT NULL DEFAULT 'pending', -- pending, sent, accepted, rejected, shipped, delivered
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_fragments_order_id ON public.order_fragments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_fragments_supplier_id ON public.order_fragments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_order_fragments_tenant_id ON public.order_fragments(tenant_id);

-- Habilitar RLS
ALTER TABLE public.order_fragments ENABLE ROW LEVEL SECURITY;

-- Políticas
DROP POLICY IF EXISTS "Lojistas veem seus fragmentos" ON public.order_fragments;
CREATE POLICY "Lojistas veem seus fragmentos" ON public.order_fragments
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Fornecedores veem fragmentos destinados a eles" ON public.order_fragments;
CREATE POLICY "Fornecedores veem fragmentos destinados a eles" ON public.order_fragments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = order_fragments.supplier_id
      AND s.tenant_id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid())
    )
  );

-- Atualizar supplier_product_prices para incluir campos usados no código
ALTER TABLE public.supplier_product_prices 
ADD COLUMN IF NOT EXISTS variations jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS price_types jsonb DEFAULT '["both"]'::jsonb, -- Mudado para jsonb para bater com o cast do frontend
ADD COLUMN IF NOT EXISTS description text;

-- Garantir que a RPC get_supplier_by_token exista com o nome de argumento _token (usado no hook)
CREATE OR REPLACE FUNCTION public.get_supplier_by_token(_token text)
RETURNS SETOF public.suppliers AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.suppliers
  WHERE access_token = _token
  AND active::boolean = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para gerar access_token se nulo
CREATE OR REPLACE FUNCTION public.ensure_supplier_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.access_token IS NULL THEN
    NEW.access_token := encode(gen_random_bytes(16), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_supplier_token ON public.suppliers;
CREATE TRIGGER trg_ensure_supplier_token
  BEFORE INSERT ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_supplier_token();

-- Atualizar fornecedores existentes sem token
UPDATE public.suppliers SET access_token = encode(gen_random_bytes(16), 'hex') WHERE access_token IS NULL;

-- Grant permissions
GRANT ALL ON public.order_fragments TO authenticated;
GRANT ALL ON public.order_fragments TO service_role;
GRANT SELECT ON public.supplier_product_prices TO anon;
