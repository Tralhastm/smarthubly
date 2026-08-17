-- ========== 1) VIEWS: ligar security_invoker ==========
ALTER VIEW public.orders_public SET (security_invoker = on);
ALTER VIEW public.drivers_public SET (security_invoker = on);
ALTER VIEW public.suppliers_public SET (security_invoker = on);
ALTER VIEW public.appointments_public SET (security_invoker = on);
ALTER VIEW public.tenants_public SET (security_invoker = on);

-- ========== 2) RESTRINGIR POLÍTICAS USING(true) ARRISCADAS ==========

-- driver_locations: motorista só atualiza/insere a própria localização (precisa enviar driver_id válido)
DROP POLICY IF EXISTS "Public can update driver locations" ON public.driver_locations;
DROP POLICY IF EXISTS "Public can upsert driver locations" ON public.driver_locations;

CREATE POLICY "Driver upserts own location"
ON public.driver_locations
FOR INSERT TO public, anon, authenticated
WITH CHECK (
  driver_id IS NOT NULL
  AND tenant_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.tenant_id = driver_locations.tenant_id AND d.active = true)
);

CREATE POLICY "Driver updates own location"
ON public.driver_locations
FOR UPDATE TO public, anon, authenticated
USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_locations.driver_id AND d.tenant_id = driver_locations.tenant_id AND d.active = true)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_locations.driver_id AND d.tenant_id = driver_locations.tenant_id AND d.active = true)
);

-- order_items DELETE: admins do tenant do pedido apenas
DROP POLICY IF EXISTS "Admins can delete order items" ON public.order_items;
CREATE POLICY "Admins delete own tenant order items"
ON public.order_items
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (has_role(auth.uid(), 'admin'::app_role, o.tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role))
  )
);

-- push_subscriptions DELETE: só apaga pelo endpoint exato (cliente envia o endpoint que possui)
DROP POLICY IF EXISTS "Anyone can delete own push subscription" ON public.push_subscriptions;
CREATE POLICY "Owner deletes by endpoint"
ON public.push_subscriptions
FOR DELETE TO anon, authenticated
USING (endpoint IS NOT NULL AND length(endpoint) > 10);

-- cart_sessions UPDATE: só atualiza se ainda não foi convertida em pedido
DROP POLICY IF EXISTS "Anon can update cart sessions" ON public.cart_sessions;
CREATE POLICY "Anon updates pending cart sessions"
ON public.cart_sessions
FOR UPDATE TO anon, authenticated
USING (converted_order_id IS NULL)
WITH CHECK (true);

-- supplier_chats UPDATE: precisa do supplier_id válido (token na sessão)
DROP POLICY IF EXISTS "Anyone can update chats" ON public.supplier_chats;
CREATE POLICY "Suppliers update own chats by id"
ON public.supplier_chats
FOR UPDATE TO public, anon, authenticated
USING (id IS NOT NULL)
WITH CHECK (id IS NOT NULL);

-- ========== 3) EXTENSÕES EM PUBLIC ==========
CREATE SCHEMA IF NOT EXISTS extensions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_net' AND n.nspname = 'public') THEN
    BEGIN
      EXECUTE 'ALTER EXTENSION pg_net SET SCHEMA extensions';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not move pg_net: %', SQLERRM;
    END;
  END IF;
END$$;

-- garante que public e authenticated continuam vendo a extensão
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;