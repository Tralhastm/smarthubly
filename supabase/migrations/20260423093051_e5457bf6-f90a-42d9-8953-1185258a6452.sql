-- Adiciona raio máximo de entrega na tabela tenants e suppliers
-- 0 ou NULL = sem limite (comportamento atual)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS delivery_max_radius_km numeric NOT NULL DEFAULT 0;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS delivery_max_radius_km numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tenants.delivery_max_radius_km IS 'Raio máximo (km) que a loja entrega. 0 = sem limite.';
COMMENT ON COLUMN public.suppliers.delivery_max_radius_km IS 'Raio máximo (km) que o fornecedor entrega. 0 = sem limite.';