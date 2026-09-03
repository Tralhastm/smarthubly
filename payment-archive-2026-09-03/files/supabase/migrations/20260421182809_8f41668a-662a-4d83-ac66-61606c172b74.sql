-- 1) Teto opcional de frete por loja e por fornecedor
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS shipping_max_fee NUMERIC;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS shipping_max_fee NUMERIC;

COMMENT ON COLUMN public.tenants.shipping_max_fee IS 'Teto opcional do frete cobrado do cliente (em R$). NULL = sem teto.';
COMMENT ON COLUMN public.suppliers.shipping_max_fee IS 'Teto opcional do frete do fornecedor (em R$). Tem prioridade sobre o teto da loja quando definido.';

-- 2) Modo de disponibilidade por produto: entrega e/ou retirada
-- 'both' (padrão): aceita entrega e retirada conforme config da loja
-- 'delivery_only': só entrega (não aparece na opção de retirada)
-- 'pickup_only': só retirada (cliente não pode pedir delivery deste item)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS availability_mode TEXT NOT NULL DEFAULT 'both';

COMMENT ON COLUMN public.products.availability_mode IS 'Disponibilidade: both | delivery_only | pickup_only';