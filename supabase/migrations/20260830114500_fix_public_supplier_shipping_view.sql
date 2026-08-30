-- O checkout público precisa ler a origem e a tabela de frete do fornecedor.
-- A view anterior usava security_invoker e herdava o bloqueio RLS da tabela
-- suppliers para anon, fazendo o endereço parecer inexistente.
-- Mantemos a ordem das colunas existentes e adicionamos tenant_id no final.
-- A view expõe somente campos operacionais de frete, sem token/credenciais.
CREATE OR REPLACE VIEW public.suppliers_public AS
SELECT
  id,
  address,
  shipping_base_fee,
  shipping_base_radius_km,
  shipping_per_km_fee,
  shipping_max_fee,
  delivery_max_radius_km,
  tenant_id
FROM public.suppliers;

GRANT SELECT ON public.suppliers_public TO anon, authenticated;
