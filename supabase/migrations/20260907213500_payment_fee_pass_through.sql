ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payment_fee_pass_through_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_fee_pass_through_percent numeric(6,3) NOT NULL DEFAULT 4.98;

COMMENT ON COLUMN public.tenants.payment_fee_pass_through_enabled IS 'Repasse opcional da taxa estimada do Checkout para pagamentos online.';
COMMENT ON COLUMN public.tenants.payment_fee_pass_through_percent IS 'Percentual estimado da taxa do Checkout usado no gross-up do pagamento online.';

CREATE OR REPLACE VIEW public.tenants_public AS
SELECT
  t.id, t.name, t.slug, t.logo_url, t.address, t.phone, t.whatsapp, t.description,
  t.active, t.blocked, t.blocked_reason, t.blocked_at, t.delivery_mode, t.niche,
  t.is_dropshipping, t.platform_fee, t.platform_fee_percent, t.shipping_enabled,
  t.shipping_base_fee, t.shipping_base_radius_km, t.shipping_per_km_fee,
  t.shipping_origin_address, t.shipping_mode, t.shipping_max_fee, t.shipping_lalamove_auto,
  t.shipping_lalamove_margin_percent, t.shipping_lalamove_apply_cap, t.delivery_max_radius_km,
  t.splash_bg_color, t.brand_primary_color, t.brand_bg_color, t.promo_title, t.promo_text,
  t.promo_active, t.store_mode, t.pickup_enabled, t.pix_key, t.pix_key_type,
  t.delivery_responsible, t.lalamove_enabled, t.lalamove_market, t.lalamove_sandbox,
  t.printer_enabled, t.printer_paper_width, t.scheduling_auto_confirm, t.scheduling_enabled,
  t.scheduling_open_days, t.scheduling_open_time, t.scheduling_close_time,
  t.scheduling_slot_minutes, t.scheduling_capacity, t.quotes_enabled, t.quotes_intro_text,
  t.fee_mode, t.fee_split_store_percent, t.billing_mode, t.monthly_fee, t.is_donated,
  t.auto_dropshipping_enabled, t.dropshipping_review_mode, t.sound_alert_enabled,
  t.sound_alert_loud, t.created_at, t.updated_at,
  (t.mercadopago_enabled AND t.mercadopago_token IS NOT NULL AND length(t.mercadopago_token) > 0
    OR t.pagbank_token IS NOT NULL AND length(t.pagbank_token) > 0
    OR t.asaas_enabled AND t.payment_provider = 'asaas') AS has_online_payment,
  t.demo_payment_enabled, t.payment_provider, t.asaas_enabled, t.mercadopago_enabled,
  t.payment_fee_pass_through_enabled, t.payment_fee_pass_through_percent
FROM public.tenants t;
