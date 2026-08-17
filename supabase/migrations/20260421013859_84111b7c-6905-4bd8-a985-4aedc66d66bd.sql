ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS scheduling_capacity integer NOT NULL DEFAULT 1;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS max_concurrent integer;

COMMENT ON COLUMN public.tenants.scheduling_capacity IS 'Quantos atendimentos a loja consegue fazer ao mesmo tempo (ex: 5 cadeiras de barbeiro)';
COMMENT ON COLUMN public.products.max_concurrent IS 'Limite de atendimentos simultâneos para este serviço específico (NULL = usa o teto da loja)';