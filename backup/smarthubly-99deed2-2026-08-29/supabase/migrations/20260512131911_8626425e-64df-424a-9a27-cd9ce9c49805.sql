ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS uber_direct_use_platform_keys boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.uber_direct_use_platform_keys IS 
'Quando TRUE, esta loja usa as chaves Uber Direct globais da plataforma (sandbox de demonstração). Controlado pelo super-admin.';