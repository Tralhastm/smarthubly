
CREATE TABLE public.fee_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  requested_percent numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  admin_note text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can insert fee requests" ON public.fee_requests
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Admins can view own fee requests" ON public.fee_requests
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id) OR has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can update fee requests" ON public.fee_requests
  FOR UPDATE TO authenticated
  USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can delete fee requests" ON public.fee_requests
  FOR DELETE TO authenticated
  USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));
