ALTER VIEW public.tenants_public SET (security_invoker = off);
GRANT SELECT ON public.tenants_public TO anon, authenticated;