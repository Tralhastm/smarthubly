CREATE POLICY "Tenant admins can update own tenant"
ON public.tenants FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role, id))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role, id));