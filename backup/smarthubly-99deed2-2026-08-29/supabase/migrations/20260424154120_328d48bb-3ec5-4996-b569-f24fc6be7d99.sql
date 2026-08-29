
-- Restaura SELECT geral pra anon e revoga só as colunas sensíveis.
-- (PostgREST falha em select=* se não tiver grant na tabela)

-- =========================
-- TENANTS
-- =========================
GRANT SELECT ON public.tenants TO anon;
REVOKE SELECT (
  mercadopago_token,
  lalamove_api_key,
  lalamove_api_secret,
  printer_agent_token,
  billing_email
) ON public.tenants FROM anon;

-- =========================
-- DRIVERS
-- =========================
GRANT SELECT ON public.drivers TO anon;
REVOKE SELECT (access_token, phone) ON public.drivers FROM anon;

-- =========================
-- SUPPLIERS
-- =========================
GRANT SELECT ON public.suppliers TO anon;
REVOKE SELECT (access_token, lalamove_api_key, lalamove_api_secret) ON public.suppliers FROM anon;

-- =========================
-- ORDERS
-- =========================
GRANT SELECT ON public.orders TO anon;
REVOKE SELECT (customer_phone) ON public.orders FROM anon;

-- =========================
-- APPOINTMENTS
-- =========================
GRANT SELECT ON public.appointments TO anon;
REVOKE SELECT (customer_name, customer_phone) ON public.appointments FROM anon;

-- =========================
-- PUSH_SUBSCRIPTIONS
-- =========================
-- Esses dados não devem aparecer pra anon de forma alguma.
-- Mantemos sem GRANT SELECT (fica bloqueado por padrão).
-- Insert e delete públicos via policy continuam funcionando.
