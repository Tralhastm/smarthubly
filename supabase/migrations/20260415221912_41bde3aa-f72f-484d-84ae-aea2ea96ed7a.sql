
CREATE TABLE public.api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL DEFAULT 'google_ai',
  api_key text NOT NULL,
  is_exhausted boolean NOT NULL DEFAULT false,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view api_keys"
ON public.api_keys FOR SELECT TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can insert api_keys"
ON public.api_keys FOR INSERT TO authenticated
WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can update api_keys"
ON public.api_keys FOR UPDATE TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE POLICY "Super admins can delete api_keys"
ON public.api_keys FOR DELETE TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_api_keys_updated_at
BEFORE UPDATE ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
