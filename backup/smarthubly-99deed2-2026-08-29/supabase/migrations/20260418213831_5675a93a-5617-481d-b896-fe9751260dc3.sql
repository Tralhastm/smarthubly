-- Adiciona UNIQUE em driver_id para suportar upsert da edge function update-driver-location.
-- Sem isso, o segundo update de localização do mesmo motoboy falha com erro de conflito.
ALTER TABLE public.driver_locations
  ADD CONSTRAINT driver_locations_driver_id_unique UNIQUE (driver_id);

-- Índice para a query do hook useTenantDriverLocations (filtra por tenant_id)
CREATE INDEX IF NOT EXISTS idx_driver_locations_tenant_id ON public.driver_locations(tenant_id);