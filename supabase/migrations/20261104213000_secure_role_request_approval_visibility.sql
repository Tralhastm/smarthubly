-- Make pending admin role requests visible only to the platform super admins
-- and approved admins of the requested tenant. Requests are created through the
-- SECURITY DEFINER request_admin_role_by_email RPC, not direct client inserts.
ALTER TABLE public.role_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.role_requests FROM anon, authenticated;
GRANT SELECT ON TABLE public.role_requests TO authenticated;
GRANT UPDATE (status) ON TABLE public.role_requests TO authenticated;

DROP POLICY IF EXISTS "Authorized admins read role requests" ON public.role_requests;
CREATE POLICY "Authorized admins read role requests"
  ON public.role_requests
  FOR SELECT
  TO authenticated
  USING (
    public.has_platform_role(auth.uid(), 'super_admin'::public.platform_role)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = role_requests.tenant_id
        AND ur.role = 'admin'
        AND ur.approved = true
    )
  );

DROP POLICY IF EXISTS "Authorized admins update role request status" ON public.role_requests;
CREATE POLICY "Authorized admins update role request status"
  ON public.role_requests
  FOR UPDATE
  TO authenticated
  USING (
    public.has_platform_role(auth.uid(), 'super_admin'::public.platform_role)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = role_requests.tenant_id
        AND ur.role = 'admin'
        AND ur.approved = true
    )
  )
  WITH CHECK (
    public.has_platform_role(auth.uid(), 'super_admin'::public.platform_role)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = role_requests.tenant_id
        AND ur.role = 'admin'
        AND ur.approved = true
    )
  );
