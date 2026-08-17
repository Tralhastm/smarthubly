CREATE TABLE public.ai_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  base_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_exhausted boolean NOT NULL DEFAULT false,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view ai_workers" ON public.ai_workers FOR SELECT TO authenticated USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Super admins can insert ai_workers" ON public.ai_workers FOR INSERT TO authenticated WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Super admins can update ai_workers" ON public.ai_workers FOR UPDATE TO authenticated USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));
CREATE POLICY "Super admins can delete ai_workers" ON public.ai_workers FOR DELETE TO authenticated USING (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_ai_workers_updated_at BEFORE UPDATE ON public.ai_workers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();