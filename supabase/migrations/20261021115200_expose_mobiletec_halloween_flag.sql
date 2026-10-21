-- Expose only the seasonal boolean needed by the Mobiletec storefront.
-- Do not expose storefront_config or modify the payment-related tenants_public view.
CREATE OR REPLACE VIEW public.mobiletec_halloween_public AS
SELECT
  CASE
    WHEN jsonb_typeof(t.storefront_config::jsonb -> 'halloween_theme_enabled') = 'boolean'
      THEN (t.storefront_config::jsonb ->> 'halloween_theme_enabled')::boolean
    ELSE true
  END AS halloween_theme_enabled
FROM public.tenants AS t
WHERE t.slug = 'mobiletec'
LIMIT 1;

GRANT SELECT ON public.mobiletec_halloween_public TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
