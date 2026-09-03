
-- ============================================================
-- Estratégia "view pública": cria views sem campos sensíveis
-- e remove SELECT direto de anon nas tabelas base
-- ============================================================

-- ---------- TENANTS ----------
CREATE OR REPLACE VIEW public.tenants_public
WITH (security_invoker = on) AS
SELECT
  id, name, slug, logo_url, address, phone, whatsapp, description, active,
  delivery_mode, niche, is_dropshipping, platform_fee, platform_fee_percent,
  shipping_enabled, shipping_base_fee, shipping_base_radius_km,
  shipping_per_km_fee, shipping_origin_address, shipping_mode,
  shipping_max_fee, shipping_lalamove_auto, shipping_lalamove_margin_percent,
  shipping_lalamove_apply_cap, delivery_max_radius_km,
  splash_bg_color, brand_primary_color, brand_bg_color,
  promo_title, promo_text, promo_active,
  store_mode, pickup_enabled, pix_key, pix_key_type, delivery_responsible,
  lalamove_enabled, lalamove_market, lalamove_sandbox,
  printer_enabled, printer_paper_width,
  scheduling_auto_confirm, scheduling_enabled, scheduling_open_days,
  scheduling_open_time, scheduling_close_time, scheduling_slot_minutes,
  scheduling_capacity, quotes_enabled, quotes_intro_text,
  fee_mode, fee_split_store_percent, billing_mode, monthly_fee,
  is_donated, auto_dropshipping_enabled, dropshipping_review_mode,
  sound_alert_enabled, sound_alert_loud,
  created_at, updated_at
FROM public.tenants;

GRANT SELECT ON public.tenants_public TO anon, authenticated;

-- Remove SELECT público da tabela base; admins/owners continuam por outras policies
DROP POLICY IF EXISTS "Public can read active tenants" ON public.tenants;
CREATE POLICY "Authenticated can read tenants" ON public.tenants
  FOR SELECT TO authenticated USING (true);

-- ---------- DRIVERS ----------
CREATE OR REPLACE VIEW public.drivers_public
WITH (security_invoker = on) AS
SELECT id, tenant_id, name, supplier_id, active, is_online, last_online_at, created_at
FROM public.drivers;

GRANT SELECT ON public.drivers_public TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read driver basics" ON public.drivers;
CREATE POLICY "Authenticated can read drivers" ON public.drivers
  FOR SELECT TO authenticated USING (true);

-- ---------- SUPPLIERS ----------
CREATE OR REPLACE VIEW public.suppliers_public
WITH (security_invoker = on) AS
SELECT
  id, tenant_id, name, address, phone, responsible_for_delivery, active,
  shipping_base_fee, shipping_base_radius_km, shipping_per_km_fee,
  shipping_mode, shipping_max_fee, delivery_max_radius_km,
  lalamove_market, lalamove_sandbox, lalamove_use_store_api,
  created_at, updated_at
FROM public.suppliers;

GRANT SELECT ON public.suppliers_public TO anon, authenticated;

-- Suppliers já tem uma policy "Admins can view suppliers"? checar; se não, garantir SELECT pra autenticados via tabela base ainda funciona
DROP POLICY IF EXISTS "Public can read supplier basics" ON public.suppliers;
-- Nota: SELECT já existe pra admins via has_role; criamos uma fallback geral autenticada
CREATE POLICY "Authenticated can read suppliers" ON public.suppliers
  FOR SELECT TO authenticated USING (true);

-- ---------- ORDERS ----------
CREATE OR REPLACE VIEW public.orders_public
WITH (security_invoker = on) AS
SELECT
  id, tenant_id, supplier_id, status, total, delivery_fee, discount_amount,
  delivery_type, payment_method, customer_name, customer_address,
  delivery_status_note, lalamove_status, lalamove_driver_name,
  lalamove_driver_plate, lalamove_share_link,
  driver_id, distance, created_at, updated_at, coupon_code, change_for,
  print_count, printed_at
FROM public.orders;

GRANT SELECT ON public.orders_public TO anon, authenticated;

DROP POLICY IF EXISTS "Anon can read orders by id" ON public.orders;
-- Admins seguem com SELECT via has_role
-- Anon perde SELECT direto na tabela base

-- ---------- APPOINTMENTS ----------
CREATE OR REPLACE VIEW public.appointments_public
WITH (security_invoker = on) AS
SELECT id, tenant_id, order_id, product_id, product_name,
  scheduled_start, planned_duration_minutes, actual_end, status,
  delay_minutes, created_at, updated_at
FROM public.appointments;

GRANT SELECT ON public.appointments_public TO anon, authenticated;

DROP POLICY IF EXISTS "Anon can read appointment basics" ON public.appointments;
-- Admins seguem com SELECT via has_role
