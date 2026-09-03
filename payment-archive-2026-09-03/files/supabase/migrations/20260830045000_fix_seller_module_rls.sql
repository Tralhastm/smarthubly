-- Corrige as políticas do módulo de vendedores.
-- As tabelas usam tenant_id text, enquanto has_role recebe uuid.
-- INSERT precisa de WITH CHECK; USING sozinho só filtra linhas existentes.

DROP POLICY IF EXISTS sellers_tenant_access ON public.sellers;
CREATE POLICY sellers_tenant_access
  ON public.sellers FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

DROP POLICY IF EXISTS seller_codes_tenant_access ON public.seller_codes;
CREATE POLICY seller_codes_tenant_access
  ON public.seller_codes FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

DROP POLICY IF EXISTS seller_order_items_tenant_access ON public.seller_order_items;
CREATE POLICY seller_order_items_tenant_access
  ON public.seller_order_items FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

-- O checkout público registra a comissão somente quando o código, vendedor e
-- pedido pertencem ao mesmo tenant. A leitura pública continua limitada à
-- política seller_codes_public_read existente.
DROP POLICY IF EXISTS seller_order_items_public_insert ON public.seller_order_items;
CREATE POLICY seller_order_items_public_insert
  ON public.seller_order_items FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.seller_codes c
      JOIN public.sellers s ON s.id = c.seller_id AND s.tenant_id = c.tenant_id
      JOIN public.orders o ON o.id = seller_order_items.order_id AND o.tenant_id = seller_order_items.tenant_id
      WHERE c.id = seller_order_items.seller_code_id
        AND c.seller_id = seller_order_items.seller_id
        AND c.tenant_id = seller_order_items.tenant_id
        AND c.active = true
        AND s.active = true
    )
  );

DROP POLICY IF EXISTS seller_payouts_tenant_access ON public.seller_payouts;
CREATE POLICY seller_payouts_tenant_access
  ON public.seller_payouts FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role, tenant_id::uuid)
    OR public.has_platform_role(auth.uid(), 'super_admin'::platform_role)
  );

-- Incremento atômico do uso do código; o checkout não deve depender de UPDATE
-- direto do cliente anônimo (que seria bloqueado pelo RLS).
CREATE OR REPLACE FUNCTION public.increment_seller_code_use(_code_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.seller_codes
     SET uses_count = uses_count + 1,
         updated_at = now()
   WHERE id = _code_id
     AND active = true
     AND (expires_at IS NULL OR expires_at > now())
     AND (max_uses IS NULL OR uses_count < max_uses)
  RETURNING true;
$$;

GRANT EXECUTE ON FUNCTION public.increment_seller_code_use(text) TO anon, authenticated;
