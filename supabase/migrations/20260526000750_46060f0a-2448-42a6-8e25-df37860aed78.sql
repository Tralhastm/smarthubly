
-- Revert views to security_definer so they bypass base-table RLS and expose only safe columns
ALTER VIEW public.tenants_public SET (security_invoker = off);
ALTER VIEW public.drivers_public SET (security_invoker = off);
ALTER VIEW public.suppliers_public SET (security_invoker = off);
ALTER VIEW public.orders_public SET (security_invoker = off);
ALTER VIEW public.appointments_public SET (security_invoker = off);

-- Drop the broad anon SELECT policies that were only needed for security_invoker views
DROP POLICY IF EXISTS "Anon read tenants via public view" ON public.tenants;
DROP POLICY IF EXISTS "Anon read suppliers via public view" ON public.suppliers;
DROP POLICY IF EXISTS "Anon read appointments via public view" ON public.appointments;

-- Make sure anon can SELECT from the *_public views (they hide secrets)
GRANT SELECT ON public.tenants_public TO anon, authenticated;
GRANT SELECT ON public.drivers_public TO anon, authenticated;
GRANT SELECT ON public.suppliers_public TO anon, authenticated;
GRANT SELECT ON public.orders_public TO anon, authenticated;
GRANT SELECT ON public.appointments_public TO anon, authenticated;
