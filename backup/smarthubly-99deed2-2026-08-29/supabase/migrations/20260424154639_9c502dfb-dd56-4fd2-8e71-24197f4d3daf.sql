
DROP POLICY IF EXISTS "Anon can read tenants" ON public.tenants;
DROP POLICY IF EXISTS "Anon can read drivers" ON public.drivers;
DROP POLICY IF EXISTS "Anon can read suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Anon can read orders" ON public.orders;
DROP POLICY IF EXISTS "Anon can read appointments" ON public.appointments;

-- Para a view security_invoker funcionar pra anon, troco as views para SECURITY DEFINER (executa como owner)
ALTER VIEW public.tenants_public SET (security_invoker = off);
ALTER VIEW public.drivers_public SET (security_invoker = off);
ALTER VIEW public.suppliers_public SET (security_invoker = off);
ALTER VIEW public.orders_public SET (security_invoker = off);
ALTER VIEW public.appointments_public SET (security_invoker = off);
