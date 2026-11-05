-- Configuração financeira do catálogo por loja.
-- Os gastos gerais reaproveitam market_pricer_expenses (product_id NULL),
-- enquanto tenants guarda o lucro mínimo e a comissão do vendedor.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS catalog_minimum_profit NUMERIC(12,2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS catalog_seller_share_percent NUMERIC(7,4) NOT NULL DEFAULT 20;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_catalog_minimum_profit_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_catalog_minimum_profit_check
  CHECK (catalog_minimum_profit >= 0);

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_catalog_seller_share_percent_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_catalog_seller_share_percent_check
  CHECK (catalog_seller_share_percent >= 0 AND catalog_seller_share_percent <= 100);

COMMENT ON COLUMN public.tenants.catalog_minimum_profit IS
  'Lucro líquido mínimo, após gastos e comissão, para o produto aparecer como disponível no catálogo.';
COMMENT ON COLUMN public.tenants.catalog_seller_share_percent IS
  'Percentual da comissão do vendedor aplicado sobre o lucro operacional positivo do catálogo.';

-- Inicializa cada loja com os gastos que já faziam parte da política anterior.
-- O INSERT é idempotente e preserva gastos personalizados já cadastrados.
INSERT INTO public.market_pricer_expenses (tenant_id, label, amount_type, amount, enabled, product_id)
SELECT t.id, defaults.label, defaults.amount_type, defaults.amount, true, NULL
  FROM public.tenants t
 CROSS JOIN (VALUES
   ('Taxa sobre a venda', 'percentage', 4.99::numeric),
   ('Motoboy / logística', 'fixed', 50::numeric),
   ('Desconto padrão', 'fixed', 10::numeric)
 ) AS defaults(label, amount_type, amount)
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.market_pricer_expenses e
    WHERE e.tenant_id = t.id
      AND e.product_id IS NULL
      AND lower(trim(e.label)) = lower(trim(defaults.label))
 );

-- A vitrine pública não pode ler a tabela administrativa diretamente. Este RPC
-- devolve somente a configuração necessária para calcular disponibilidade.
CREATE OR REPLACE FUNCTION public.get_catalog_pricing_config(_tenant_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_minimum_profit NUMERIC := 0;
  v_seller_share NUMERIC := 0;
  v_expenses JSONB := '[]'::jsonb;
BEGIN
  SELECT COALESCE(t.catalog_minimum_profit, 0),
         COALESCE(t.catalog_seller_share_percent, 0)
    INTO v_minimum_profit, v_seller_share
    FROM public.tenants t
   WHERE t.id = _tenant_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'label', e.label,
        'amountType', e.amount_type,
        'amount', e.amount,
        'enabled', e.enabled
      ) ORDER BY e.created_at, e.id
    ), '[]'::jsonb
  )
    INTO v_expenses
    FROM public.market_pricer_expenses e
   WHERE e.tenant_id = _tenant_id
     AND e.product_id IS NULL
     AND e.enabled = true;

  RETURN jsonb_build_object(
    'minimumProfit', COALESCE(v_minimum_profit, 0),
    'sellerSharePercent', COALESCE(v_seller_share, 0),
    'expenses', COALESCE(v_expenses, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_pricing_config(TEXT) TO anon, authenticated, service_role;
