
CREATE TABLE IF NOT EXISTS public.prospect_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('won','lost')),
  niche text,
  pain_signals text[] DEFAULT '{}',
  what_worked text DEFAULT '',
  what_failed text DEFAULT '',
  key_lesson text NOT NULL,
  conversation_excerpt jsonb DEFAULT '[]'::jsonb,
  weight integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prospect_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage learnings"
ON public.prospect_learnings
FOR ALL TO authenticated
USING (has_platform_role(auth.uid(), 'super_admin'::platform_role))
WITH CHECK (has_platform_role(auth.uid(), 'super_admin'::platform_role));

CREATE INDEX IF NOT EXISTS prospect_learnings_outcome_idx ON public.prospect_learnings(outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS prospect_learnings_niche_idx ON public.prospect_learnings(niche);
