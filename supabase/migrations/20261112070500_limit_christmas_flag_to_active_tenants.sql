-- Keep the public seasonal projection minimal and hide rows for unavailable stores.
-- The view intentionally runs with owner privileges like the other safe public tenant views,
-- but returns only active, non-blocked tenants and never exposes storefront_config itself.
CREATE OR REPLACE VIEW public.tenant_christmas_public
WITH (security_invoker = false) AS
SELECT
  t.slug,
  CASE
    WHEN jsonb_typeof(t.storefront_config::jsonb -> 'christmas_theme_enabled') = 'boolean'
      THEN (t.storefront_config::jsonb ->> 'christmas_theme_enabled')::boolean
    ELSE false
  END AS christmas_theme_enabled
FROM public.tenants AS t
WHERE t.slug IS NOT NULL
  AND t.active IS TRUE
  AND COALESCE(t.blocked, false) IS FALSE;

GRANT SELECT ON public.tenant_christmas_public TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
