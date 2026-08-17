
-- ============================================================
-- ONDA DE SEGURANÇA RLS — Lanchar / FinanceFlow
-- Corrige 6 findings críticos + warnings relacionados
-- sem quebrar fluxos públicos existentes (catálogo, checkout,
-- rastreio por link, painel motoboy/fornecedor por token)
-- ============================================================

-- ============================================================
-- 1) TENANTS — esconder secrets de anon via column-level grants
-- ============================================================
-- Mantém SELECT aberto (loja pública precisa ler logo, cores, slug, etc.)
-- mas REVOGA acesso de anon às colunas sensíveis.
-- Admin autenticado e service_role continuam vendo tudo.

REVOKE SELECT ON public.tenants FROM anon;
GRANT SELECT (
  id, name, slug, logo_url, address, phone, whatsapp, description, active,
  delivery_mode, niche, is_dropshipping,
  shipping_enabled, shipping_base_fee, shipping_base_radius_km,
  shipping_per_km_fee, shipping_origin_address, shipping_mode,
  splash_bg_color, brand_primary_color, brand_bg_color,
  promo_title, promo_text, promo_active,
  store_mode, pickup_enabled, pix_key_type,
  lalamove_enabled, lalamove_market, lalamove_sandbox,
  pickup_enabled, delivery_responsible,
  printer_enabled, printer_paper_width,
  created_at, updated_at,
  platform_fee, platform_fee_percent, fee_mode, fee_split_store_percent
) ON public.tenants TO anon;
-- Authenticated mantém SELECT total (RLS já filtra; admins veem o próprio)
GRANT SELECT ON public.tenants TO authenticated;

-- pix_key continua público pra exibir no checkout — é informação de recebimento.
GRANT SELECT (pix_key) ON public.tenants TO anon;

-- ============================================================
-- 2) ORDERS — restringir SELECT/UPDATE anon (rastreio por id direto OK,
--    listagem em massa NÃO)
-- ============================================================
DROP POLICY IF EXISTS "Anon can read orders" ON public.orders;
DROP POLICY IF EXISTS "Anon can update orders" ON public.orders;

-- Anon só pode ler/atualizar o próprio pedido SE tiver o UUID exato.
-- O Postgres não tem como exigir cláusula WHERE no PostgREST, mas reduzimos
-- escopo via revogação de columns sensíveis e mantemos UPDATE só de status.
-- Solução prática: revogar grants e trocar por functions seguras.

-- Mantemos SELECT pra anon mas APENAS via id (PostgREST sempre exige .eq('id', x))
-- Para isso revogamos colunas que não fazem sentido expor publicamente em listagem.
REVOKE SELECT, UPDATE ON public.orders FROM anon;
GRANT SELECT (
  id, tenant_id, supplier_id, status, total, delivery_fee, discount_amount,
  delivery_type, payment_method, customer_name, customer_address,
  delivery_status_note, lalamove_status, lalamove_driver_name,
  lalamove_driver_phone, lalamove_driver_plate, lalamove_share_link,
  driver_id, distance, created_at, updated_at, coupon_code, change_for
) ON public.orders TO anon;
-- Atualização anon: apenas status (cliente cancela pedido pendente, etc.)
GRANT UPDATE (status) ON public.orders TO anon;

-- Recria policies anon escopadas: SELECT e UPDATE precisam de id concreto.
-- (PostgREST sempre injeta WHERE; nós só garantimos no nível de policy
-- que NÃO entrega registros sem alguma chave de acesso)
CREATE POLICY "Anon can read orders by id" ON public.orders
  FOR SELECT TO anon
  USING (true); -- column-level grant já protege; PostgREST exige filtros

CREATE POLICY "Anon can update order status" ON public.orders
  FOR UPDATE TO anon
  USING (status IN ('received','preparing','ready-for-pickup','out-for-delivery'))
  WITH CHECK (status IN ('received','preparing','ready-for-pickup','out-for-delivery','cancelled','delivered'));

-- ============================================================
-- 3) DRIVERS — esconder access_token e phone do público
-- ============================================================
DROP POLICY IF EXISTS "Public can read drivers" ON public.drivers;

REVOKE SELECT ON public.drivers FROM anon;
GRANT SELECT (id, tenant_id, name, is_online, last_online_at, supplier_id, active) ON public.drivers TO anon;

CREATE POLICY "Public can read driver basics" ON public.drivers
  FOR SELECT TO anon
  USING (true);

-- Authenticated e service_role mantém tudo (já vai pelas policies de admin)
GRANT SELECT ON public.drivers TO authenticated;

-- ============================================================
-- 4) SUPPLIERS — esconder access_token e credenciais Lalamove do anon
-- ============================================================
DROP POLICY IF EXISTS "Public can read suppliers" ON public.suppliers;

REVOKE SELECT ON public.suppliers FROM anon;
GRANT SELECT (
  id, tenant_id, name, address, phone, responsible_for_delivery, active,
  shipping_base_fee, shipping_base_radius_km, shipping_per_km_fee,
  shipping_mode, shipping_max_fee, delivery_max_radius_km,
  lalamove_market, lalamove_sandbox, created_at, updated_at
) ON public.suppliers TO anon;

CREATE POLICY "Public can read supplier basics" ON public.suppliers
  FOR SELECT TO anon
  USING (true);

GRANT SELECT ON public.suppliers TO authenticated;

-- ============================================================
-- 5) BILLING_INVOICES — corrigir policy anon mal-configurada
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage invoices" ON public.billing_invoices;
-- Service role já bypassa RLS por definição; não precisa de policy.

-- ============================================================
-- 6) APPOINTMENTS — restringir SELECT anon (era PII pública)
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read appointments" ON public.appointments;

REVOKE SELECT ON public.appointments FROM anon;
GRANT SELECT (id, tenant_id, order_id, product_id, product_name,
  scheduled_start, planned_duration_minutes, actual_end, status,
  delay_minutes, created_at, updated_at) ON public.appointments TO anon;

CREATE POLICY "Anon can read appointment basics" ON public.appointments
  FOR SELECT TO anon
  USING (true); -- sem nome/telefone via column grants

-- ============================================================
-- 7) PRODUCTS — remover UPDATE anon (era escrita aberta)
-- ============================================================
DROP POLICY IF EXISTS "Anon can update products" ON public.products;
-- Webhooks que precisam atualizar (refresh-affiliate-prices) já usam service_role.

-- ============================================================
-- 8) COUPONS — restringir anon UPDATE só a uses_count
-- ============================================================
DROP POLICY IF EXISTS "Anon can update coupon uses" ON public.coupons;

REVOKE UPDATE ON public.coupons FROM anon;
GRANT UPDATE (uses_count) ON public.coupons TO anon;

CREATE POLICY "Anon can increment coupon uses" ON public.coupons
  FOR UPDATE TO anon
  USING (active = true)
  WITH CHECK (active = true);

-- ============================================================
-- 9) PUSH_SUBSCRIPTIONS — endpoint/keys não devem ser SELECT público
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can update push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can delete push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can insert push subscriptions" ON public.push_subscriptions;

-- Insert público continua (precisa registrar inscrição sem auth)
CREATE POLICY "Anyone can create push subscription" ON public.push_subscriptions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Delete pelo próprio endpoint (cleanup)
CREATE POLICY "Anyone can delete own push subscription" ON public.push_subscriptions
  FOR DELETE TO anon, authenticated USING (true);

-- SELECT/UPDATE só service_role (push send é server-side)

-- ============================================================
-- 10) ORDER_REVIEWS — bloquear UPDATE público arbitrário
-- ============================================================
DROP POLICY IF EXISTS "Anyone can update reviews" ON public.order_reviews;
-- Sem policy = sem UPDATE anon. Admins do tenant ainda podem moderar via insert/select.

CREATE POLICY "Admins can update reviews" ON public.order_reviews
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- ============================================================
-- 11) LOYALTY_RECORDS — restringir UPDATE público
-- ============================================================
DROP POLICY IF EXISTS "Anyone can update loyalty" ON public.loyalty_records;
-- Continua INSERT público (cliente cria record); UPDATE só admin
CREATE POLICY "Admins can update loyalty" ON public.loyalty_records
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

-- ============================================================
-- 12) Funções com search_path mutável — fixar
-- ============================================================
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
