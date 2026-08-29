ALTER TABLE public.street_prospects
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suggested_next_message TEXT,
  ADD COLUMN IF NOT EXISTS last_analysis_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_street_prospects_reminder ON public.street_prospects (reminder_at) WHERE reminder_at IS NOT NULL;