ALTER TABLE public.street_prospects
  ADD COLUMN IF NOT EXISTS manual_intel text DEFAULT '',
  ADD COLUMN IF NOT EXISTS pasted_history text DEFAULT '',
  ADD COLUMN IF NOT EXISTS conversation_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_draft text DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_review_notes text DEFAULT '';