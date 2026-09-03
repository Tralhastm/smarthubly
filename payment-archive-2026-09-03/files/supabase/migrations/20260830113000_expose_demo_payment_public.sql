-- O Super Admin grava demo_payment_enabled em tenants, mas a view pública
-- não expunha essa coluna. Por isso o checkout do cliente nunca recebia a flag.
CREATE OR REPLACE VIEW public.tenants_public
WITH (security_invoker = on) AS
SELECT
  id, name, slug, logo_url, address, phone, whatsapp, description, active,
  blocked, blocked_reason, blocked_at, delivery_mode, niche, is_dropshipping,
  platform_fee, platform_fee_percent, shipping_enabled, shipping_base_fee,
  shipping_base_radius_km, shipping_per_km_fee, shipping_origin_address,
  shipping_mode, shipping_max_fee, shipping_lalamove_auto,
  shipping_lalamove_margin_percent, shipping_lalamove_apply_cap,
  delivery_max_radius_km, splash_bg_color, brand_primary_color, brand_bg_color,
  promo_title, promo_text, promo_active, store_mode, pickup_enabled, pix_key,
  pix_key_type, delivery_responsible, lalamove_enabled, lalamove_market,
  lalamove_sandbox, printer_enabled, printer_paper_width,
  scheduling_auto_confirm, scheduling_enabled, scheduling_open_days,
  scheduling_open_time, scheduling_close_time, scheduling_slot_minutes,
  scheduling_capacity, quotes_enabled, quotes_intro_text, fee_mode,
  fee_split_store_percent, billing_mode, monthly_fee, is_donated,
  auto_dropshipping_enabled, dropshipping_review_mode, sound_alert_enabled,
  sound_alert_loud, created_at, updated_at,
  (mercadopago_token IS NOT NULL AND length(mercadopago_token) > 0)
    OR COALESCE(demo_payment_enabled, false) AS has_online_payment,
  COALESCE(demo_payment_enabled, false) AS demo_payment_enabled
FROM public.tenants;

GRANT SELECT ON public.tenants_public TO anon, authenticated;
