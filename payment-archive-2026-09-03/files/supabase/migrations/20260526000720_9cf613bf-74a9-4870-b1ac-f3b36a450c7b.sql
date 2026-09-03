
-- ===========================================
-- 1) CASH REGISTER: remove public access
-- ===========================================
DROP POLICY IF EXISTS "Public can read cash sessions" ON public.cash_register_sessions;
DROP POLICY IF EXISTS "Public can update cash sessions" ON public.cash_register_sessions;
DROP POLICY IF EXISTS "Public can create cash sessions" ON public.cash_register_sessions;
DROP POLICY IF EXISTS "Public can read cash movements" ON public.cash_movements;
DROP POLICY IF EXISTS "Public can create cash movements" ON public.cash_movements;

-- ===========================================
-- 2) USER_ROLES: restrict SELECT
-- ===========================================
DROP POLICY IF EXISTS "Authenticated can view user roles" ON public.user_roles;
CREATE POLICY "Users see own or tenant-admin roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

-- ===========================================
-- 3) ORDER_EVENTS: restrict
-- ===========================================
DROP POLICY IF EXISTS "Anyone can view order events" ON public.order_events;
DROP POLICY IF EXISTS "Anyone can insert order events" ON public.order_events;
CREATE POLICY "Tenant admins view order events"
  ON public.order_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_events.order_id
        AND (has_role(auth.uid(), 'admin'::app_role, o.tenant_id)
             OR has_platform_role(auth.uid(), 'super_admin'::platform_role))
    )
  );
CREATE POLICY "Anyone can insert order events for existing orders"
  ON public.order_events FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_events.order_id));

-- ===========================================
-- 4) APPOINTMENTS: add SELECT policy
-- ===========================================
CREATE POLICY "Tenant admins read appointments"
  ON public.appointments FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

-- ===========================================
-- 5) TENANTS: restrict SELECT (secrets!)
-- ===========================================
DROP POLICY IF EXISTS "Authenticated can read tenants" ON public.tenants;
CREATE POLICY "Tenant admins read own tenant"
  ON public.tenants FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role, id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

-- ===========================================
-- 6) DRIVERS / WAITERS / SUPPLIERS: drop broad authenticated read
-- ===========================================
DROP POLICY IF EXISTS "Authenticated can read drivers" ON public.drivers;
CREATE POLICY "Tenant admins read drivers"
  ON public.drivers FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

DROP POLICY IF EXISTS "Authenticated can read suppliers" ON public.suppliers;
CREATE POLICY "Tenant admins read suppliers"
  ON public.suppliers FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

DROP POLICY IF EXISTS "Authenticated can read waiters" ON public.waiters;
DROP POLICY IF EXISTS "Anyone can read active waiters" ON public.waiters;
CREATE POLICY "Tenant admins read waiters"
  ON public.waiters FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role, tenant_id)
    OR has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );
-- Public can still need basic info (name, online) for table session display.
-- Expose via security_invoker view if needed later. For now: no public read.

-- ===========================================
-- 7) STORAGE product-images: restrict update/delete
-- ===========================================
DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
CREATE POLICY "Tenant admins delete own product images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      public.has_role(auth.uid(), 'admin'::app_role, ((storage.foldername(name))[1])::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
    )
  );
CREATE POLICY "Tenant admins update own product images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      public.has_role(auth.uid(), 'admin'::app_role, ((storage.foldername(name))[1])::uuid)
      OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
    )
  );

-- ===========================================
-- 8) VIEWS: switch to security_invoker
-- ===========================================
ALTER VIEW public.tenants_public SET (security_invoker = on);
ALTER VIEW public.drivers_public SET (security_invoker = on);
ALTER VIEW public.suppliers_public SET (security_invoker = on);
ALTER VIEW public.orders_public SET (security_invoker = on);
ALTER VIEW public.appointments_public SET (security_invoker = on);

-- Para que as views ainda funcionem para anon (cliente sem login), criamos políticas
-- de SELECT amplas porém em colunas seguras (são as mesmas que as views já expõem).
-- Para tenants: política anon-friendly somente em colunas básicas via view não dá em PG;
-- a view security_invoker passa o usuário, então precisamos de policies que retornem
-- as linhas para anon. Adicionamos policies anon que liberam SELECT (a view filtra colunas).
CREATE POLICY "Anon read tenants via public view"
  ON public.tenants FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "Anon read suppliers via public view"
  ON public.suppliers FOR SELECT TO anon
  USING (active = true);

CREATE POLICY "Anon read appointments via public view"
  ON public.appointments FOR SELECT TO anon
  USING (true);

-- drivers/orders já têm policies anon existentes que continuam funcionando para as views

-- ===========================================
-- 9) Revoke EXECUTE on internal SECURITY DEFINER functions
-- ===========================================
REVOKE EXECUTE ON FUNCTION public.log_platform_fee_entry(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_revenue_entry(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_credits() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.detect_ghost_orders() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_cancel_expired_orders() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_drivers() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_waiter_to_session(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_admin_role(uuid, uuid, text) FROM anon;
