-- Adicionar status online/offline aos motoboys próprios
ALTER TABLE public.drivers 
ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS last_online_at timestamp with time zone;

-- Index pra consulta rápida de motoboys disponíveis por tenant
CREATE INDEX IF NOT EXISTS idx_drivers_tenant_online 
ON public.drivers(tenant_id, is_online, active) 
WHERE is_online = true AND active = true;