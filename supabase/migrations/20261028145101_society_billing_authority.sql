-- Sociedade ativa substitui a cobrança padrão da plataforma.
-- Quando ativa, não há taxa percentual por pedido nem mensalidade fixa:
-- a participação da plataforma é definida pelo acordo e pelo fechamento da Sociedade.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS society_billing_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Lojas que já possuem regras de acordo passam a respeitar a Sociedade.
UPDATE public.tenants t
   SET society_billing_enabled = TRUE
 WHERE EXISTS (
   SELECT 1 FROM public.partnership_cost_rules r WHERE r.tenant_id = t.id
 );

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
  t.auto_dropshipping_enabled, t.dropshipping_review_mode,
  t.sound_alert_enabled, t.sound_alert_loud, t.created_at, t.updated_at,
  (t.mercadopago_enabled AND t.mercadopago_token IS NOT NULL AND length(t.mercadopago_token) > 0
    OR t.pagbank_token IS NOT NULL AND length(t.pagbank_token) > 0
    OR t.asaas_enabled AND t.payment_provider = 'asaas') AS has_online_payment,
  t.demo_payment_enabled, t.payment_provider, t.asaas_enabled, t.mercadopago_enabled,
  t.payment_fee_pass_through_enabled, t.payment_fee_pass_through_percent,
  t.shipping_discount_enabled, t.shipping_discount_type, t.shipping_discount_value,
  t.shipping_discount_auto, t.catalog_layout, t.product_splash_enabled, t.show_description,
  t.show_title, t.pickup_as_delivery_fallback, t.dropshipping_submode,
  t.whatsapp_consultora_phone, t.whatsapp_store_address, t.whatsapp_store_cep,
  t.whatsapp_default_address_source,
  t.society_billing_enabled
FROM public.tenants t;

GRANT SELECT ON public.tenants_public TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Impede o registro de uma taxa automática por pedido em lojas com Sociedade.
CREATE OR REPLACE FUNCTION public.log_platform_fee_entry(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_marker TEXT;
  v_exists INT;
BEGIN
  SELECT o.id, o.tenant_id, o.platform_fee, o.status, t.auto_log_platform_fee,
         t.billing_mode, t.society_billing_enabled
    INTO v_order
    FROM public.orders o
    JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.id = _order_id;
  IF NOT FOUND OR v_order.auto_log_platform_fee = FALSE OR v_order.society_billing_enabled = TRUE THEN RETURN FALSE; END IF;
  IF v_order.billing_mode = 'monthly_fixed' OR v_order.platform_fee IS NULL OR v_order.platform_fee <= 0 THEN RETURN FALSE; END IF;
  IF v_order.status <> 'delivered' THEN RETURN FALSE; END IF;
  v_marker := '#PLATFORM_FEE:' || _order_id::text;
  SELECT COUNT(*) INTO v_exists FROM public.financial_entries
   WHERE tenant_id = v_order.tenant_id AND description ILIKE '%' || v_marker || '%';
  IF v_exists > 0 THEN RETURN FALSE; END IF;
  INSERT INTO public.financial_entries (tenant_id, type, category, description, amount, date)
  VALUES (v_order.tenant_id, 'expense', 'taxa_plataforma',
          'Taxa da plataforma — pedido ' || substr(_order_id::text, 1, 8) || ' ' || v_marker,
          v_order.platform_fee, now());
  RETURN TRUE;
END;
$$;
