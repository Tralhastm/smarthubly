CREATE TABLE public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin select platform_settings" ON public.platform_settings
  FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "super_admin insert platform_settings" ON public.platform_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "super_admin update platform_settings" ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "super_admin delete platform_settings" ON public.platform_settings
  FOR DELETE TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'));