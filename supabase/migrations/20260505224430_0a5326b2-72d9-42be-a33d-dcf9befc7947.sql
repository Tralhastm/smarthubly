
CREATE TABLE public.street_prospects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  street_name TEXT NOT NULL,
  store_name TEXT NOT NULL,
  has_contact BOOLEAN NOT NULL DEFAULT false,
  contact_phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_contacted',
  message_sent BOOLEAN NOT NULL DEFAULT false,
  responded BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT DEFAULT '',
  chosen_plan TEXT DEFAULT '',
  liked_point TEXT DEFAULT '',
  refusal_reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  visited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.street_prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage street prospects"
ON public.street_prospects FOR ALL TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE TRIGGER update_street_prospects_updated_at
BEFORE UPDATE ON public.street_prospects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_street_prospects_street ON public.street_prospects(street_name);
CREATE INDEX idx_street_prospects_status ON public.street_prospects(status);
