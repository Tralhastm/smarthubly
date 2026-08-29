CREATE POLICY "Platform admins manage stock movements"
ON public.stock_movements
FOR ALL
TO authenticated
USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Platform admins manage ingredients"
ON public.ingredients
FOR ALL
TO authenticated
USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Platform admins manage debts"
ON public.debts
FOR ALL
TO authenticated
USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Platform admins manage nfe_imports"
ON public.nfe_imports
FOR ALL
TO authenticated
USING (public.has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'::platform_role));