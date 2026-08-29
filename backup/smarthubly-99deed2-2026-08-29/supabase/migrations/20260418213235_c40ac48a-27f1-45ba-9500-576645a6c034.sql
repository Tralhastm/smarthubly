
-- Tabela de localização em tempo real do motoboy
CREATE TABLE public.driver_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  accuracy numeric,
  heading numeric,
  speed numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX driver_locations_driver_id_key ON public.driver_locations(driver_id);
CREATE INDEX driver_locations_tenant_idx ON public.driver_locations(tenant_id);

ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

-- Qualquer um pode ler (cliente acompanha pedido sem login)
CREATE POLICY "Public can read driver locations"
ON public.driver_locations FOR SELECT TO public USING (true);

-- Qualquer um pode inserir/atualizar (motoboy autentica via access_token na edge function)
CREATE POLICY "Public can upsert driver locations"
ON public.driver_locations FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Public can update driver locations"
ON public.driver_locations FOR UPDATE TO public USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
ALTER TABLE public.driver_locations REPLICA IDENTITY FULL;
