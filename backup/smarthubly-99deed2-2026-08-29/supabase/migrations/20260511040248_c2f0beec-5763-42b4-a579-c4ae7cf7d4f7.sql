
CREATE TABLE public.remote_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  phone text,
  city text,
  niche text,
  instagram_handle text,
  website_url text,
  has_website boolean NOT NULL DEFAULT false,
  has_instagram boolean NOT NULL DEFAULT false,
  priority_score int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new',
  initial_message text,
  conversation_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  source text,
  raw_data jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_remote_prospects_status ON public.remote_prospects(status);
CREATE INDEX idx_remote_prospects_priority ON public.remote_prospects(priority_score DESC);
CREATE INDEX idx_remote_prospects_city_niche ON public.remote_prospects(city, niche);

ALTER TABLE public.remote_prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admins read remote_prospects"
  ON public.remote_prospects FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "super admins insert remote_prospects"
  ON public.remote_prospects FOR INSERT TO authenticated
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "super admins update remote_prospects"
  ON public.remote_prospects FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "super admins delete remote_prospects"
  ON public.remote_prospects FOR DELETE TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_remote_prospects_updated_at
  BEFORE UPDATE ON public.remote_prospects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
