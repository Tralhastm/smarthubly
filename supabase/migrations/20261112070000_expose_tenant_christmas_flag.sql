-- Expose only a public per-tenant boolean required by the seasonal storefront.
-- Do not expose the full storefront_config JSON or modify existing tenant views.
CREATE OR REPLACE VIEW public.tenant_christmas_public AS
SELECT
  t.slug,
  CASE
    WHEN jsonb_typeof(t.storefront_config::jsonb -> 'christmas_theme_enabled') = 'boolean'
      THEN (t.storefront_config::jsonb ->> 'christmas_theme_enabled')::boolean
    ELSE false
  END AS christmas_theme_enabled
FROM public.tenants AS t
WHERE t.slug IS NOT NULL;

GRANT SELECT ON public.tenant_christmas_public TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
